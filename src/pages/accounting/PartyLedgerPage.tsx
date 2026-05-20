import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format, subDays } from "date-fns";

const sb = supabase as any;

export default function PartyLedgerPage() {
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 90), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [partyId, setPartyId] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("all");

  const { data: parties } = useQuery({
    queryKey: ["acc-pl-parties"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_parties")
        .select("id, name, party_type, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const filteredParties = useMemo(() => {
    if (!parties) return [];
    return filterType === "all" ? parties : parties.filter((p: any) => p.party_type === filterType);
  }, [parties, filterType]);

  useEffect(() => {
    if (!partyId && filteredParties.length) setPartyId(filteredParties[0].id);
  }, [filteredParties, partyId]);

  // Opening balance: all lines for this party BEFORE fromDate (Dr - Cr)
  const { data: opening } = useQuery({
    queryKey: ["acc-pl-opening", partyId, fromDate],
    queryFn: async () => {
      if (!partyId) return 0;
      const { data, error } = await sb
        .from("accounting_voucher_lines")
        .select("debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date)")
        .eq("party_id", partyId)
        .lt("voucher.voucher_date", fromDate);
      if (error) throw error;
      return (data || []).reduce((s: number, l: any) => s + Number(l.debit_amount || 0) - Number(l.credit_amount || 0), 0);
    },
    enabled: !!partyId,
  });

  const { data: lines } = useQuery({
    queryKey: ["acc-pl-lines", partyId, fromDate, toDate],
    queryFn: async () => {
      if (!partyId) return [];
      const { data, error } = await sb
        .from("accounting_voucher_lines")
        .select("*, voucher:accounting_vouchers!inner(voucher_number, voucher_type, voucher_date, narration, source_module, source_reference_id), account:accounting_chart_of_accounts(code, name)")
        .eq("party_id", partyId)
        .gte("voucher.voucher_date", fromDate)
        .lte("voucher.voucher_date", toDate);
      if (error) throw error;
      return (data || []).sort((a: any, b: any) => {
        const ad = a.voucher?.voucher_date || "";
        const bd = b.voucher?.voucher_date || "";
        if (ad !== bd) return ad < bd ? -1 : 1;
        return (a.voucher?.voucher_number || "").localeCompare(b.voucher?.voucher_number || "");
      });
    },
    enabled: !!partyId,
  });

  // Resolve domestic-sales vouchers (source_reference_id = dispatch_id) to their invoice ids
  // so we can deep-link from the ledger row directly into the invoice view.
  const dispatchIdsToResolve = useMemo(() => {
    const set = new Set<string>();
    (lines || []).forEach((l: any) => {
      if (l.voucher?.source_module === "domestic_sales" && l.voucher?.source_reference_id) {
        set.add(l.voucher.source_reference_id);
      }
    });
    return Array.from(set);
  }, [lines]);

  const { data: dispatchInvoiceMap } = useQuery({
    queryKey: ["acc-pl-dispatch-invoice-map", dispatchIdsToResolve],
    queryFn: async () => {
      if (!dispatchIdsToResolve.length) return {} as Record<string, string>;
      const { data, error } = await sb
        .from("domestic_invoices")
        .select("id, dispatch_id")
        .in("dispatch_id", dispatchIdsToResolve);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data || []).forEach((r: any) => { if (r.dispatch_id) map[r.dispatch_id] = r.id; });
      return map;
    },
    enabled: dispatchIdsToResolve.length > 0,
  });

  const resolveSourceLink = (v: any): string | null => {
    if (!v) return null;
    if (v.source_module === "domestic_sales" && v.source_reference_id) {
      const invoiceId = dispatchInvoiceMap?.[v.source_reference_id];
      if (invoiceId) return `/domestic/invoices?invoice=${invoiceId}`;
    }
    return null;
  };

  const rows = useMemo(() => {
    if (!lines) return [];
    let bal = Number(opening || 0);
    return lines.map((l: any) => {
      bal += Number(l.debit_amount || 0) - Number(l.credit_amount || 0);
      return { ...l, runningBalance: bal };
    });
  }, [lines, opening]);

  const totalDr = (lines || []).reduce((s: number, l: any) => s + Number(l.debit_amount || 0), 0);
  const totalCr = (lines || []).reduce((s: number, l: any) => s + Number(l.credit_amount || 0), 0);
  const closing = Number(opening || 0) + totalDr - totalCr;
  const selectedParty = parties?.find((p: any) => p.id === partyId);

  return (
    <ERPLayout>
      <PageHeader title="Party Ledger" description="Customer / supplier / employee account statement">
        <div className="flex gap-2">
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="customer">Customer</SelectItem>
              <SelectItem value="supplier">Supplier</SelectItem>
              <SelectItem value="employee">Employee</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <Select value={partyId} onValueChange={setPartyId}>
            <SelectTrigger className="w-[280px]"><SelectValue placeholder="Party" /></SelectTrigger>
            <SelectContent className="max-h-[400px]">
              {filteredParties?.map((p: any) => (
                <SelectItem key={p.id} value={p.id}>{p.name} <span className="text-xs text-muted-foreground">({p.party_type})</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[150px]" />
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[150px]" />
        </div>
      </PageHeader>

      {selectedParty && (
        <div className="grid grid-cols-4 gap-4 mb-4">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Party</div><div className="text-sm font-semibold">{selectedParty.name}</div><Badge variant="outline" className="text-xs capitalize mt-1">{selectedParty.party_type}</Badge></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Opening</div><div className="text-xl font-semibold">Rs. {Number(opening || 0).toLocaleString()}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Movement</div><div className="text-xs text-green-600">Dr: Rs. {totalDr.toLocaleString()}</div><div className="text-xs text-red-600">Cr: Rs. {totalCr.toLocaleString()}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Closing</div><div className="text-xl font-semibold">Rs. {Math.abs(closing).toLocaleString()} <span className="text-xs text-muted-foreground">{closing >= 0 ? "Dr" : "Cr"}</span></div></CardContent></Card>
        </div>
      )}

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Voucher</TableHead>
              <TableHead>Against A/c</TableHead>
              <TableHead>Narration</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-muted/40">
              <TableCell colSpan={6} className="text-xs italic">Opening Balance</TableCell>
              <TableCell className="text-right font-semibold">Rs. {Number(opening || 0).toLocaleString()}</TableCell>
            </TableRow>
            {!rows.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No transactions for this party in this range</TableCell></TableRow>}
            {rows.map((r: any) => {
              const sourceHref = resolveSourceLink(r.voucher);
              return (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{r.voucher?.voucher_date && format(new Date(r.voucher.voucher_date), "dd MMM yyyy")}</TableCell>
                <TableCell className="text-xs">
                  <Badge variant="outline" className="font-mono text-[10px] mr-1">{r.voucher?.voucher_type}</Badge>
                  {sourceHref ? (
                    <Link
                      to={sourceHref}
                      className="text-primary hover:underline inline-flex items-center gap-1"
                      title="Open source invoice"
                    >
                      {r.voucher?.voucher_number}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  ) : (
                    r.voucher?.voucher_number
                  )}
                </TableCell>
                <TableCell className="text-xs">{r.account?.name || "—"}</TableCell>
                <TableCell className="text-xs max-w-[260px] truncate">{r.line_narration || r.voucher?.narration || "—"}</TableCell>
                <TableCell className="text-right text-xs">{Number(r.debit_amount) > 0 ? `Rs. ${Number(r.debit_amount).toLocaleString()}` : "—"}</TableCell>
                <TableCell className="text-right text-xs">{Number(r.credit_amount) > 0 ? `Rs. ${Number(r.credit_amount).toLocaleString()}` : "—"}</TableCell>
                <TableCell className="text-right text-xs font-medium">Rs. {r.runningBalance.toLocaleString()}</TableCell>
              </TableRow>
              );
            })}
            <TableRow className="bg-muted/40 font-semibold">
              <TableCell colSpan={4}>Period Total / Closing</TableCell>
              <TableCell className="text-right">Rs. {totalDr.toLocaleString()}</TableCell>
              <TableCell className="text-right">Rs. {totalCr.toLocaleString()}</TableCell>
              <TableCell className="text-right">Rs. {closing.toLocaleString()}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </ERPLayout>
  );
}
