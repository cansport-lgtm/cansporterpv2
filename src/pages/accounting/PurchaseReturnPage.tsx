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
import { toast } from "@/hooks/use-toast";
import { ArrowUpLeft } from "lucide-react";
import { format, parseISO } from "date-fns";
import { postPurchaseReturn } from "@/lib/accounting/postPurchaseReturn";

const sb = supabase as any;
type Category = "raw_material" | "office_supplies" | "general_supplies" | "spare_maintenance";

export default function PurchaseReturnPage() {
  const queryClient = useQueryClient();
  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<Category>("raw_material");
  const [returnDate, setReturnDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const { data: parties } = useQuery({
    queryKey: ["supplier-parties"],
    queryFn: async () => {
      const { data } = await sb.from("accounting_parties").select("id, name, code").eq("party_type", "supplier").eq("is_active", true).order("name");
      return data || [];
    },
  });

  const { data: history } = useQuery({
    queryKey: ["purchase-return-history"],
    queryFn: async () => {
      const { data } = await sb
        .from("accounting_vouchers")
        .select("voucher_number, voucher_date, total_amount, narration, party:accounting_parties(name)")
        .ilike("narration", "Purchase return%")
        .order("voucher_date", { ascending: false })
        .limit(10);
      return data || [];
    },
  });

  const postMutation = useMutation({
    mutationFn: async () => {
      const result = await postPurchaseReturn({
        partyId,
        returnDate,
        amount: parseFloat(amount),
        category,
        reference: reference || undefined,
        note: note || undefined,
      });
      if (!result.ok) throw new Error(result.error || "Failed");
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-return-history"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["ap-aging"] });
      toast({ title: result.skipped === "flag_off" ? "Flag is OFF" : `Purchase return posted: ${result.voucherNumber}` });
      setPartyId(""); setAmount(""); setReference(""); setNote("");
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const amt = parseFloat(amount) || 0;
  const reverseAccountLabel: Record<Category, string> = {
    raw_material: "Inventory - Raw Material (1130)",
    office_supplies: "Office Supplies expense (5208)",
    general_supplies: "Miscellaneous Expense (5216)",
    spare_maintenance: "Repair & Maintenance (5210)",
  };

  return (
    <ERPLayout>
      <PageHeader title="Purchase Return / Debit Note" description="Return goods to supplier — reverses original GRN posting" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><ArrowUpLeft className="h-4 w-4" />Record Purchase Return</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Supplier *</Label>
              <Select value={partyId} onValueChange={setPartyId}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {parties?.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Return Date *</Label><Input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)} /></div>
            <div>
              <Label>Category *</Label>
              <Select value={category} onValueChange={(v: Category) => setCategory(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="raw_material">Raw Material</SelectItem>
                  <SelectItem value="office_supplies">Office Supplies</SelectItem>
                  <SelectItem value="general_supplies">General Supplies</SelectItem>
                  <SelectItem value="spare_maintenance">Spare & Maintenance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Amount *</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 5000" /></div>
            <div><Label>Reference (debit note #, original GRN)</Label><Input value={reference} onChange={e => setReference(e.target.value)} /></div>
            <div><Label>Note</Label><Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for return" /></div>

            <div className="border rounded-md p-3 bg-muted/30 space-y-1 text-xs">
              <div className="font-semibold text-xs mb-1">Posting Preview</div>
              <div className="flex justify-between"><span>Dr Accounts Payable (2101)</span><span className="font-medium">Rs. {amt.toLocaleString()}</span></div>
              <div className="flex justify-between"><span>Cr {reverseAccountLabel[category]}</span><span className="font-medium">Rs. {amt.toLocaleString()}</span></div>
            </div>

            <Button className="w-full" disabled={!partyId || !amount || amt <= 0 || postMutation.isPending} onClick={() => postMutation.mutate()}>
              {postMutation.isPending ? "Posting..." : "Post Purchase Return"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Recent Purchase Returns</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Voucher #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!history?.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No purchase returns yet</TableCell></TableRow>}
                {history?.map((v: any) => (
                  <TableRow key={v.voucher_number}>
                    <TableCell className="font-mono text-xs">{v.voucher_number}</TableCell>
                    <TableCell className="text-xs">{v.voucher_date && format(parseISO(v.voucher_date), "dd MMM yyyy")}</TableCell>
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
