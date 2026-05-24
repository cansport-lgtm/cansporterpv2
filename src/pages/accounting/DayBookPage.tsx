import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { format, parseISO } from "date-fns";

const sb = supabase as any;

const typeBadge = (t: string) => {
  const colors: Record<string, string> = {
    CRV: "bg-green-100 text-green-800",
    CPV: "bg-red-100 text-red-800",
    BRV: "bg-emerald-100 text-emerald-800",
    BPV: "bg-rose-100 text-rose-800",
    JV: "bg-purple-100 text-purple-800",
    CV: "bg-blue-100 text-blue-800",
    OB: "bg-amber-100 text-amber-800",
  };
  return <Badge variant="outline" className={colors[t] || ""}>{t}</Badge>;
};

export default function DayBookPage() {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const { data: vouchers, isLoading } = useQuery({
    queryKey: ["acc-daybook", date],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_vouchers")
        .select("*, party:accounting_parties(name), lines:accounting_voucher_lines(*, account:accounting_chart_of_accounts(code, name))")
        .eq("voucher_date", date)
        .order("voucher_number");
      if (error) throw error;
      return data || [];
    },
  });

  const totalReceipts = (vouchers || []).filter((v: any) => ["CRV", "BRV"].includes(v.voucher_type)).reduce((s: number, v: any) => s + Number(v.total_amount), 0);
  const totalPayments = (vouchers || []).filter((v: any) => ["CPV", "BPV"].includes(v.voucher_type)).reduce((s: number, v: any) => s + Number(v.total_amount), 0);
  const totalAll = (vouchers || []).reduce((s: number, v: any) => s + Number(v.total_amount), 0);

  return (
    <ERPLayout>
      <PageHeader title="Day Book" description="All vouchers for the selected date">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[180px]" />
      </PageHeader>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Receipts</div><div className="text-2xl font-semibold text-green-600">Rs. {totalReceipts.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Payments</div><div className="text-2xl font-semibold text-red-600">Rs. {totalPayments.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Volume</div><div className="text-2xl font-semibold">Rs. {totalAll.toLocaleString()}</div></CardContent></Card>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Voucher #</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Party</TableHead>
              <TableHead>Posting</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isLoading && !vouchers?.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No vouchers on {format(parseISO(date), "dd MMM yyyy")}</TableCell></TableRow>}
            {vouchers?.map((v: any) => {
              const drLines = (v.lines || []).filter((l: any) => Number(l.debit_amount) > 0);
              const crLines = (v.lines || []).filter((l: any) => Number(l.credit_amount) > 0);
              return (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-xs align-top">{v.voucher_number}</TableCell>
                  <TableCell className="align-top">{typeBadge(v.voucher_type)}</TableCell>
                  <TableCell className="text-xs align-top">{v.party?.name || "—"}</TableCell>
                  <TableCell className="text-xs">
                    <div className="space-y-1">
                      {drLines.map((l: any, i: number) => (
                        <div key={`d${i}`} className="text-green-700 dark:text-green-400">
                          <span className="font-mono">Dr</span> {l.account?.name} <span className="text-muted-foreground">Rs. {Number(l.debit_amount).toLocaleString()}</span>
                        </div>
                      ))}
                      {crLines.map((l: any, i: number) => (
                        <div key={`c${i}`} className="text-red-700 dark:text-red-400 ml-4">
                          <span className="font-mono">Cr</span> {l.account?.name} <span className="text-muted-foreground">Rs. {Number(l.credit_amount).toLocaleString()}</span>
                        </div>
                      ))}
                      {v.narration && <div className="text-xs text-muted-foreground italic">({v.narration})</div>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium align-top">Rs. {Number(v.total_amount).toLocaleString()}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </ERPLayout>
  );
}
