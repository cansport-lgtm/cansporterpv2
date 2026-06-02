import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Factory, Wallet, CheckCircle, AlertTriangle } from "lucide-react";
import { format, startOfMonth, parseISO } from "date-fns";
import { useAppSetting } from "@/hooks/useAppSetting";
import { postProductionOutput } from "@/lib/accounting/postProductionOutput";

const sb = supabase as any;

export default function ProductionOutputRecognitionPage() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState("");

  // Show WIP account balance so accountant knows what's available to transfer
  const { data: wipBalance } = useQuery({
    queryKey: ["acc-output-wip-balance", date],
    queryFn: async () => {
      // Find WIP account id from default-accounts
      const { data: slot } = await sb.from("accounting_default_accounts").select("account_id").eq("key", "wip_inventory").maybeSingle();
      if (!slot?.account_id) return { balance: 0, accountName: null };
      // Sum all lines for WIP up to date
      const { data: lines } = await sb
        .from("accounting_voucher_lines")
        .select("debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date)")
        .eq("account_id", slot.account_id)
        .lte("voucher.voucher_date", date);
      const balance = (lines || []).reduce((s: number, l: any) => s + Number(l.debit_amount || 0) - Number(l.credit_amount || 0), 0);
      // Get account name
      const { data: acc } = await sb.from("accounting_chart_of_accounts").select("name, code").eq("id", slot.account_id).maybeSingle();
      return { balance, accountName: acc ? `${acc.code} ${acc.name}` : null };
    },
  });

  // Show output history for the month
  const { data: history } = useQuery({
    queryKey: ["acc-output-history"],
    queryFn: async () => {
      const fromMonth = format(startOfMonth(new Date()), "yyyy-MM-dd");
      const { data, error } = await sb
        .from("accounting_vouchers")
        .select("voucher_number, voucher_date, total_amount, narration, source_reference_id")
        .eq("source_module", "production_output")
        .gte("voucher_date", fromMonth)
        .order("voucher_date", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
  });

  const postMutation = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(amount);
      if (!amt || amt <= 0) throw new Error("Enter a positive amount");
      return postProductionOutput(date, amt, note || undefined);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["acc-output-wip-balance"] });
      queryClient.invalidateQueries({ queryKey: ["acc-output-history"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-vouchers"] });
      if (result.skipped === "flag_off") {
        toast({ title: "Auto-post flag is OFF", description: "Enable it from Accounting Settings (super-admin).", variant: "destructive" });
      } else if (result.skipped === "already_posted") {
        toast({ title: "Already posted", description: result.voucherNumber });
      } else if (result.skipped === "nothing_to_post") {
        toast({ title: "Enter a positive amount" });
      } else if (result.ok) {
        toast({ title: `Posted ${result.voucherNumber}`, description: `Rs. ${result.amount?.toLocaleString()}` });
        setAmount("");
        setNote("");
      } else {
        toast({ title: "Post failed", description: result.error, variant: "destructive" });
      }
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const { value: flagEnabled } = useAppSetting<boolean>("accounting_autopost_enabled", true);

  return (
    <ERPLayout>
      <PageHeader title="Production Output Recognition" description="Transfer completed production from WIP to Finished Goods inventory">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Auto-post flag:</span>
          {flagEnabled
            ? <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />ENABLED</Badge>
            : <Badge variant="secondary"><AlertTriangle className="h-3 w-3 mr-1" />DISABLED</Badge>}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3" />WIP Balance (as of {date})</div>
          <div className="text-2xl font-semibold">Rs. {Number(wipBalance?.balance || 0).toLocaleString()}</div>
          {wipBalance?.accountName && <div className="text-xs text-muted-foreground mt-1">{wipBalance.accountName}</div>}
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Today's Transfer Amount</div>
          <div className="text-2xl font-semibold">Rs. {(parseFloat(amount) || 0).toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">WIP After Transfer</div>
          <div className="text-2xl font-semibold">Rs. {(Number(wipBalance?.balance || 0) - (parseFloat(amount) || 0)).toLocaleString()}</div>
          {(parseFloat(amount) || 0) > Number(wipBalance?.balance || 0) && (
            <div className="text-xs text-amber-600 mt-1">⚠ Transfer exceeds current WIP — will go negative</div>
          )}
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Factory className="h-4 w-4" />New Output Recognition</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Date *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>FG Value Completed (PKR) *</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 25000" />
              <p className="text-xs text-muted-foreground mt-1">Cost of production output transferred from WIP to Finished Goods inventory.</p>
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. VM72 batch 250 dozens completed @ 100 each" />
            </div>
            <div className="border rounded-md p-3 bg-muted/30">
              <div className="text-xs font-semibold mb-2">Posting Preview</div>
              <div className="flex justify-between text-xs"><span>Dr Finished Goods Inventory</span><span className="font-medium">Rs. {(parseFloat(amount) || 0).toLocaleString()}</span></div>
              <div className="flex justify-between text-xs"><span>Cr Work-in-Progress Inventory</span><span className="font-medium">Rs. {(parseFloat(amount) || 0).toLocaleString()}</span></div>
            </div>
            <Button className="w-full" disabled={!flagEnabled || !amount || parseFloat(amount) <= 0 || postMutation.isPending} onClick={() => postMutation.mutate()}>
              {postMutation.isPending ? "Posting..." : "Post WIP → FG Transfer"}
            </Button>
            <div className="text-xs text-muted-foreground">
              Idempotent per date — only one output voucher can exist per day. To revise, delete the existing voucher first.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Recent Output Vouchers (this month)</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Voucher #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!history?.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No output transfers this month</TableCell></TableRow>}
                {history?.map((v: any) => (
                  <TableRow key={v.voucher_number}>
                    <TableCell className="font-mono text-xs">{v.voucher_number}</TableCell>
                    <TableCell className="text-xs">{v.voucher_date && format(parseISO(v.voucher_date), "dd MMM yyyy")}</TableCell>
                    <TableCell className="text-right text-xs">Rs. {Number(v.total_amount).toLocaleString()}</TableCell>
                    <TableCell className="text-xs max-w-[240px] truncate">{v.narration}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
