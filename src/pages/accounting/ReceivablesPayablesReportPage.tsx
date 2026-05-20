import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, ArrowUpRight, ArrowDownRight, Scale } from "lucide-react";
import { format } from "date-fns";
import * as XLSX from "xlsx";

const sb = supabase as any;

type Bucket = { b0_30: number; b31_60: number; b61_90: number; b90p: number };
type PartyRow = {
  party_id: string;
  name: string;
  party_type: string | null;
  total: number;
} & Bucket;

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * FIFO open-item aging. For an AR party we treat debits as "opens"
 * (outstanding invoices) and credits as settlements. Walk lines in
 * chronological order, settle oldest opens first, and bucket what's
 * left by days from voucher date to as-of date.
 */
function ageParty(lines: any[], asOfDate: string, isAR: boolean): Bucket & { total: number } {
  const sorted = [...lines].sort((a, b) => {
    const ad = a.voucher?.voucher_date || "";
    const bd = b.voucher?.voucher_date || "";
    return ad < bd ? -1 : ad > bd ? 1 : 0;
  });

  const opens: { date: string; remaining: number }[] = [];

  for (const l of sorted) {
    const open = isAR ? Number(l.debit_amount || 0) : Number(l.credit_amount || 0);
    let settle = isAR ? Number(l.credit_amount || 0) : Number(l.debit_amount || 0);

    if (open > 0) opens.push({ date: l.voucher?.voucher_date || asOfDate, remaining: open });
    while (settle > 0 && opens.length) {
      const head = opens[0];
      if (head.remaining <= settle) {
        settle -= head.remaining;
        opens.shift();
      } else {
        head.remaining -= settle;
        settle = 0;
      }
    }
  }

  const out: Bucket & { total: number } = { b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0, total: 0 };
  for (const o of opens) {
    const days = daysBetween(o.date, asOfDate);
    if (days <= 30) out.b0_30 += o.remaining;
    else if (days <= 60) out.b31_60 += o.remaining;
    else if (days <= 90) out.b61_90 += o.remaining;
    else out.b90p += o.remaining;
    out.total += o.remaining;
  }
  return out;
}

export default function ReceivablesPayablesReportPage() {
  const [asOf, setAsOf] = useState(format(new Date(), "yyyy-MM-dd"));

  const { data: defaults } = useQuery({
    queryKey: ["ar-ap-default-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_default_accounts")
        .select("key, account_id")
        .in("key", ["accounts_receivable", "accounts_payable"]);
      if (error) throw error;
      const out: { ar: string | null; ap: string | null } = { ar: null, ap: null };
      (data || []).forEach((r: any) => {
        if (r.key === "accounts_receivable") out.ar = r.account_id;
        if (r.key === "accounts_payable") out.ap = r.account_id;
      });
      return out;
    },
  });

  const { data: arLines } = useQuery({
    queryKey: ["ar-report-lines", defaults?.ar, asOf],
    queryFn: async () => {
      if (!defaults?.ar) return [];
      const { data, error } = await sb
        .from("accounting_voucher_lines")
        .select("party_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date), party:accounting_parties(name, party_type)")
        .eq("account_id", defaults.ar)
        .not("party_id", "is", null)
        .lte("voucher.voucher_date", asOf);
      if (error) throw error;
      return data || [];
    },
    enabled: !!defaults?.ar,
  });

  const { data: apLines } = useQuery({
    queryKey: ["ap-report-lines", defaults?.ap, asOf],
    queryFn: async () => {
      if (!defaults?.ap) return [];
      const { data, error } = await sb
        .from("accounting_voucher_lines")
        .select("party_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date), party:accounting_parties(name, party_type)")
        .eq("account_id", defaults.ap)
        .not("party_id", "is", null)
        .lte("voucher.voucher_date", asOf);
      if (error) throw error;
      return data || [];
    },
    enabled: !!defaults?.ap,
  });

  const groupByParty = (lines: any[], isAR: boolean): PartyRow[] => {
    const byParty: Record<string, any[]> = {};
    const names: Record<string, { name: string; party_type: string | null }> = {};
    (lines || []).forEach((l: any) => {
      if (!l.party_id) return;
      (byParty[l.party_id] ||= []).push(l);
      if (l.party) names[l.party_id] = { name: l.party.name, party_type: l.party.party_type ?? null };
    });
    const rows: PartyRow[] = [];
    Object.entries(byParty).forEach(([pid, ls]) => {
      const agg = ageParty(ls, asOf, isAR);
      if (Math.abs(agg.total) < 0.005) return;
      rows.push({
        party_id: pid,
        name: names[pid]?.name || "—",
        party_type: names[pid]?.party_type ?? null,
        ...agg,
      });
    });
    return rows.sort((a, b) => b.total - a.total);
  };

  const arRows = useMemo(() => groupByParty(arLines || [], true), [arLines, asOf]);
  const apRows = useMemo(() => groupByParty(apLines || [], false), [apLines, asOf]);

  const arTotal = arRows.reduce((s, r) => s + r.total, 0);
  const apTotal = apRows.reduce((s, r) => s + r.total, 0);
  const net = arTotal - apTotal;

  const handleExport = () => {
    const sheets: { name: string; rows: any[] }[] = [];
    sheets.push({
      name: "Receivables",
      rows: arRows.map((r) => ({
        Customer: r.name,
        "0-30": r.b0_30,
        "31-60": r.b31_60,
        "61-90": r.b61_90,
        "90+": r.b90p,
        Total: r.total,
      })),
    });
    sheets.push({
      name: "Payables",
      rows: apRows.map((r) => ({
        Vendor: r.name,
        "0-30": r.b0_30,
        "31-60": r.b31_60,
        "61-90": r.b61_90,
        "90+": r.b90p,
        Total: r.total,
      })),
    });
    sheets.push({
      name: "Summary",
      rows: [
        { Label: "Total Receivables", Amount: arTotal },
        { Label: "Total Payables", Amount: apTotal },
        { Label: "Net (AR - AP)", Amount: net },
      ],
    });
    const wb = XLSX.utils.book_new();
    sheets.forEach((s) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name));
    XLSX.writeFile(wb, `AR_AP_Report_${asOf}.xlsx`);
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Receivables & Payables"
        description="Outstanding balances by party with FIFO aging buckets"
      >
        <div className="flex gap-2 items-center">
          <span className="text-xs text-muted-foreground">As of</span>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-[160px]" />
          <Button size="sm" variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" />Export
          </Button>
        </div>
      </PageHeader>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><ArrowUpRight className="h-3 w-3" />Total Receivables</div>
            <div className="text-2xl font-semibold text-green-600">Rs. {arTotal.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">{arRows.length} customer{arRows.length === 1 ? "" : "s"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><ArrowDownRight className="h-3 w-3" />Total Payables</div>
            <div className="text-2xl font-semibold text-red-600">Rs. {apTotal.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">{apRows.length} vendor{apRows.length === 1 ? "" : "s"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Scale className="h-3 w-3" />Net Position (AR − AP)</div>
            <div className={`text-2xl font-semibold ${net >= 0 ? "text-green-600" : "text-red-600"}`}>
              Rs. {Math.abs(net).toLocaleString()} {net >= 0 ? "in our favour" : "we owe more"}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Receivables */}
        <div className="border rounded-lg">
          <div className="px-4 py-3 border-b bg-green-50 dark:bg-green-950/20 font-semibold text-sm flex items-center justify-between">
            <span>RECEIVABLES (Customers)</span>
            <span className="text-xs text-muted-foreground">click name → ledger</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">0-30</TableHead>
                <TableHead className="text-right">31-60</TableHead>
                <TableHead className="text-right">61-90</TableHead>
                <TableHead className="text-right">90+</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!arRows.length && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No outstanding receivables as of {asOf}</TableCell></TableRow>
              )}
              {arRows.map((r) => (
                <TableRow key={r.party_id}>
                  <TableCell className="text-sm">
                    <Link to={`/accounting/party-ledger?type=customer`} className="text-primary hover:underline">{r.name}</Link>
                  </TableCell>
                  <TableCell className="text-right text-xs">{r.b0_30 ? `Rs. ${r.b0_30.toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="text-right text-xs">{r.b31_60 ? `Rs. ${r.b31_60.toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="text-right text-xs">{r.b61_90 ? `Rs. ${r.b61_90.toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="text-right text-xs text-red-600">{r.b90p ? `Rs. ${r.b90p.toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="text-right text-sm font-medium">Rs. {r.total.toLocaleString()}</TableCell>
                </TableRow>
              ))}
              {arRows.length > 0 && (
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">Rs. {arRows.reduce((s, r) => s + r.b0_30, 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right">Rs. {arRows.reduce((s, r) => s + r.b31_60, 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right">Rs. {arRows.reduce((s, r) => s + r.b61_90, 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right">Rs. {arRows.reduce((s, r) => s + r.b90p, 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right">Rs. {arTotal.toLocaleString()}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Payables */}
        <div className="border rounded-lg">
          <div className="px-4 py-3 border-b bg-red-50 dark:bg-red-950/20 font-semibold text-sm flex items-center justify-between">
            <span>PAYABLES (Vendors)</span>
            <span className="text-xs text-muted-foreground">click name → ledger</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">0-30</TableHead>
                <TableHead className="text-right">31-60</TableHead>
                <TableHead className="text-right">61-90</TableHead>
                <TableHead className="text-right">90+</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!apRows.length && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No outstanding payables as of {asOf}</TableCell></TableRow>
              )}
              {apRows.map((r) => (
                <TableRow key={r.party_id}>
                  <TableCell className="text-sm">
                    <Link to={`/accounting/party-ledger?type=supplier`} className="text-primary hover:underline">{r.name}</Link>
                  </TableCell>
                  <TableCell className="text-right text-xs">{r.b0_30 ? `Rs. ${r.b0_30.toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="text-right text-xs">{r.b31_60 ? `Rs. ${r.b31_60.toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="text-right text-xs">{r.b61_90 ? `Rs. ${r.b61_90.toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="text-right text-xs text-red-600">{r.b90p ? `Rs. ${r.b90p.toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="text-right text-sm font-medium">Rs. {r.total.toLocaleString()}</TableCell>
                </TableRow>
              ))}
              {apRows.length > 0 && (
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">Rs. {apRows.reduce((s, r) => s + r.b0_30, 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right">Rs. {apRows.reduce((s, r) => s + r.b31_60, 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right">Rs. {apRows.reduce((s, r) => s + r.b61_90, 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right">Rs. {apRows.reduce((s, r) => s + r.b90p, 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right">Rs. {apTotal.toLocaleString()}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </ERPLayout>
  );
}
