import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { ArrowDownLeft } from "lucide-react";
import { format } from "date-fns";
import { postSalesReturn } from "@/lib/accounting/postSalesReturn";

const sb = supabase as any;

export default function SalesReturnPage() {
  const queryClient = useQueryClient();
  const [partyId, setPartyId] = useState("");
  const [salesAmount, setSalesAmount] = useState("");
  const [cogsAmount, setCogsAmount] = useState("");
  const [returnDate, setReturnDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const { data: parties } = useQuery({
    queryKey: ["customer-parties"],
    queryFn: async () => {
      const { data } = await sb.from("accounting_parties").select("id, name, code").eq("party_type", "customer").eq("is_active", true).order("name");
      return data || [];
    },
  });

  const { data: history } = useQuery({
    queryKey: ["sales-return-history"],
    queryFn: async () => {
      const { data } = await sb
        .from("accounting_vouchers")
        .select("voucher_number, voucher_date, total_amount, narration, party:accounting_parties(name)")
        .ilike("narration", "Sales return%")
        .order("voucher_date", { ascending: false })
        .limit(10);
      return data || [];
    },
  });

  const postMutation = useMutation({
    mutationFn: async () => {
      const result = await postSalesReturn({
        partyId,
        returnDate,
        salesAmount: parseFloat(salesAmount),
        cogsAmount: parseFloat(cogsAmount) || 0,
        reference: reference || undefined,
        note: note || undefined,
      });
      if (!result.ok) throw new Error(result.error || "Failed");
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["sales-return-history"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["ar-aging"] });
      toast({ title: result.skipped === "flag_off" ? "Flag is OFF" : `Sales return posted: ${result.voucherNumber}` });
      setPartyId(""); setSalesAmount(""); setCogsAmount(""); setReference(""); setNote("");
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const sa = parseFloat(salesAmount) || 0;
  const ca = parseFloat(cogsAmount) || 0;

  return (
    <ERPLayout>
      <PageHeader title="Sales Return / Credit Note" description="Reverse a sale: revenue and cost are both reversed" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><ArrowDownLeft className="h-4 w-4" />Record Sales Return</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Customer *</Label>
              <Select value={partyId} onValueChange={setPartyId}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {parties?.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Return Date *</Label><Input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Sales Amount (revenue reversed) *</Label>
                <Input type="number" value={salesAmount} onChange={e => setSalesAmount(e.target.value)} placeholder="e.g. 10000" />
              </div>
              <div>
                <Label>COGS Amount (cost reversed)</Label>
                <Input type="number" value={cogsAmount} onChange={e => setCogsAmount(e.target.value)} placeholder="0 if unknown" />
              </div>
            </div>
            <div><Label>Reference (credit note #, original invoice)</Label><Input value={reference} onChange={e => setReference(e.target.value)} /></div>
            <div><Label>Note</Label><Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for return" /></div>

            <div className="border rounded-md p-3 bg-muted/30 space-y-1 text-xs">
              <div className="font-semibold text-xs mb-1">Posting Preview</div>
              <div className="flex justify-between"><span>Dr Sales Returns (4010)</span><span className="font-medium">Rs. {sa.toLocaleString()}</span></div>
              <div className="flex justify-between"><span>Cr Accounts Receivable</span><span className="font-medium">Rs. {sa.toLocaleString()}</span></div>
              {ca > 0 && (
                <>
                  <div className="flex justify-between"><span>Dr Finished Goods Inventory</span><span className="font-medium">Rs. {ca.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span>Cr Cost of Goods Sold</span><span className="font-medium">Rs. {ca.toLocaleString()}</span></div>
                </>
              )}
            </div>

            <Button className="w-full" disabled={!partyId || !salesAmount || sa <= 0 || postMutation.isPending} onClick={() => postMutation.mutate()}>
              {postMutation.isPending ? "Posting..." : "Post Sales Return"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Recent Sales Returns</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Voucher #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!history?.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No sales returns yet</TableCell></TableRow>}
                {history?.map((v: any) => (
                  <TableRow key={v.voucher_number}>
                    <TableCell className="font-mono text-xs">{v.voucher_number}</TableCell>
                    <TableCell className="text-xs">{v.voucher_date && format(new Date(v.voucher_date), "dd MMM yyyy")}</TableCell>
                    <TableCell className="text-xs">{v.party?.name || "—"}</TableCell>
                    <TableCell className="text-right text-xs">Rs. {Number(v.total_amount).toLocaleString()}</TableCell>
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
