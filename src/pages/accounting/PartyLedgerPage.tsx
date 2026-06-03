import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { FileText, Printer } from "lucide-react";
import { InvoiceViewDialog } from "@/components/sales/InvoiceViewDialog";
import { InvoicePrintView } from "@/components/sales/InvoicePrintView";
import { GRNViewDialog } from "@/components/purchase/GRNViewDialog";
import { VoucherViewDialog } from "@/components/accounting/VoucherViewDialog";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format, subDays, parseISO } from "date-fns";

const sb = supabase as any;

const VALID_TYPES = new Set(["all", "customer", "supplier", "employee", "other"]);

export default function PartyLedgerPage() {
  const [searchParams] = useSearchParams();
  const initialType = (() => {
    const t = searchParams.get("type");
    return t && VALID_TYPES.has(t) ? t : "all";
  })();
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 90), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [partyId, setPartyId] = useState<string>("");
  const [filterType, setFilterType] = useState<string>(initialType);

  // React to ?type= changes (e.g. user navigates Customer Ledger -> Vendor Ledger
  // from the sidebar without remounting). Reset the selected party so we don't
  // hold a stale customer when switching to vendors.
  useEffect(() => {
    const t = searchParams.get("type");
    const next = t && VALID_TYPES.has(t) ? t : "all";
    setFilterType((prev) => (prev === next ? prev : next));
    if (t && VALID_TYPES.has(t)) setPartyId("");
  }, [searchParams]);

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

  // Resolve a voucher's underlying source document so we can open it as a modal
  // directly over the ledger.
  //   - domestic_sales:  source_reference_id is a dispatch id; we look up the invoice.
  //   - purchase:        source_reference_id IS the GRN id (the purchase invoice).
  type SourceDoc = { kind: "invoice"; id: string } | { kind: "grn"; id: string } | null;
  const resolveSourceDoc = (v: any): SourceDoc => {
    if (!v?.source_reference_id) return null;
    if (v.source_module === "domestic_sales") {
      const invoiceId = dispatchInvoiceMap?.[v.source_reference_id];
      return invoiceId ? { kind: "invoice", id: invoiceId } : null;
    }
    if (v.source_module === "purchase") {
      return { kind: "grn", id: v.source_reference_id };
    }
    return null;
  };

  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);
  const [viewGRNId, setViewGRNId] = useState<string | null>(null);
  const [viewVoucherId, setViewVoucherId] = useState<string | null>(null);
  const [printInvoiceId, setPrintInvoiceId] = useState<string | null>(null);

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

  const ledgerTitle = filterType === "customer"
    ? "Customer Ledger"
    : filterType === "supplier"
      ? "Vendor Ledger"
      : filterType === "employee"
        ? "Employee Ledger"
        : "Party Ledger";

  const handlePrint = () => {
    if (!selectedParty) return;
    window.print();
  };

  return (
    <ERPLayout>
      {/* === PRINT VIEW (only visible when printing) === */}
      {/* Suppressed while printing a single invoice so only the invoice prints. */}
      {selectedParty && !printInvoiceId && (
        <div className="hidden print:block print:fixed print:inset-0 print:bg-white print:p-8 print:z-50 print:text-foreground">
          <div className="max-w-5xl mx-auto">
            <div className="flex justify-between items-start mb-4 pb-3 border-b-2 border-gray-800">
              <div>
                <h1 className="text-2xl font-bold">{ledgerTitle}</h1>
                <div className="text-sm mt-1">Cansport Global Industries</div>
              </div>
              <div className="text-right text-sm">
                <div className="font-bold">{selectedParty.name}</div>
                <div className="text-xs">{selectedParty.code || ""}</div>
                <div className="text-xs capitalize">{selectedParty.party_type}</div>
                <div className="text-xs mt-1">Period: {format(parseISO(fromDate), "dd MMM yyyy")} to {format(parseISO(toDate), "dd MMM yyyy")}</div>
              </div>
            </div>

            <table className="w-full text-xs mb-4 border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-800">
                  <th className="text-left py-1.5">Date</th>
                  <th className="text-left py-1.5">Voucher</th>
                  <th className="text-left py-1.5">Against A/c</th>
                  <th className="text-left py-1.5">Narration</th>
                  <th className="text-right py-1.5">Debit</th>
                  <th className="text-right py-1.5">Credit</th>
                  <th className="text-right py-1.5">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-300 bg-gray-50">
                  <td colSpan={6} className="py-1.5 italic">Opening Balance</td>
                  <td className="text-right py-1.5 font-semibold">Rs. {Number(opening || 0).toLocaleString()}</td>
                </tr>
                {!rows.length && (
                  <tr><td colSpan={7} className="text-center py-3 text-gray-500">No transactions in this period.</td></tr>
                )}
                {rows.map((r: any) => (
                  <tr key={r.id} className="border-b border-gray-200">
                    <td className="py-1.5">{r.voucher?.voucher_date && format(parseISO(r.voucher.voucher_date), "dd MMM yyyy")}</td>
                    <td className="py-1.5">
                      <span className="font-mono mr-1">{r.voucher?.voucher_type}</span>
                      {r.voucher?.voucher_number}
                    </td>
                    <td className="py-1.5">{r.account?.name || "—"}</td>
                    <td className="py-1.5">{r.line_narration || r.voucher?.narration || "—"}</td>
                    <td className="text-right py-1.5">{Number(r.debit_amount) > 0 ? `Rs. ${Number(r.debit_amount).toLocaleString()}` : "—"}</td>
                    <td className="text-right py-1.5">{Number(r.credit_amount) > 0 ? `Rs. ${Number(r.credit_amount).toLocaleString()}` : "—"}</td>
                    <td className="text-right py-1.5">Rs. {r.runningBalance.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-800 font-bold">
                  <td colSpan={4} className="text-right py-2">Period Total / Closing</td>
                  <td className="text-right py-2">Rs. {totalDr.toLocaleString()}</td>
                  <td className="text-right py-2">Rs. {totalCr.toLocaleString()}</td>
                  <td className="text-right py-2">Rs. {Math.abs(closing).toLocaleString()} <span className="font-normal">{closing >= 0 ? "Dr" : "Cr"}</span></td>
                </tr>
              </tfoot>
            </table>

            <div className="text-xs text-gray-500 border-t pt-3 mt-6">
              <div className="grid grid-cols-2 gap-8 mt-6">
                <div className="border-t pt-1">Prepared by</div>
                <div className="border-t pt-1">Authorised Signature</div>
              </div>
              <div className="mt-4 text-[10px]">E. & O. E. — figures subject to internal audit. Subject to Karachi jurisdiction.</div>
            </div>
          </div>
        </div>
      )}

      {/* === MAIN UI (hidden when printing) === */}
      <div className="print:hidden">
      <PageHeader
        title={ledgerTitle}
        description="Account statement with opening, movement and closing balances"
      >
        <div className="flex gap-2 flex-wrap">
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
          <SearchableSelect
            value={partyId}
            onValueChange={setPartyId}
            options={(filteredParties || []).map((p: any) => ({ value: p.id, label: p.name, secondary: `(${p.party_type})`, search: p.code || "" }))}
            placeholder="Party"
            triggerClassName="w-[280px]"
          />
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[150px]" />
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[150px]" />
          <Button size="sm" variant="outline" onClick={handlePrint} disabled={!selectedParty}>
            <Printer className="h-4 w-4 mr-1" />Print
          </Button>
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
              const sourceDoc = resolveSourceDoc(r.voucher);
              const openSource = () => {
                if (!sourceDoc) return;
                if (sourceDoc.kind === "invoice") setViewInvoiceId(sourceDoc.id);
                else if (sourceDoc.kind === "grn") setViewGRNId(sourceDoc.id);
              };
              const sourceTitle = sourceDoc?.kind === "grn" ? "Open purchase invoice (GRN)" : "Open source invoice";
              return (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{r.voucher?.voucher_date && format(parseISO(r.voucher.voucher_date), "dd MMM yyyy")}</TableCell>
                <TableCell className="text-xs">
                  <Badge variant="outline" className="font-mono text-[10px] mr-1">{r.voucher?.voucher_type}</Badge>
                  <button
                    type="button"
                    onClick={() => setViewVoucherId(r.voucher_id)}
                    className="text-primary hover:underline"
                    title="Open voucher"
                  >
                    {r.voucher?.voucher_number}
                  </button>
                  {sourceDoc && (
                    <button
                      type="button"
                      onClick={openSource}
                      className="text-primary hover:underline inline-flex items-center ml-1 align-middle"
                      title={sourceTitle}
                    >
                      <FileText className="h-3 w-3" />
                    </button>
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

      <InvoiceViewDialog
        invoiceId={viewInvoiceId}
        onOpenChange={(o) => !o && setViewInvoiceId(null)}
        onPrint={(id) => { setViewInvoiceId(null); setPrintInvoiceId(id); }}
      />
      <InvoicePrintView
        invoiceId={printInvoiceId}
        onAfterPrint={() => setPrintInvoiceId(null)}
      />
      <GRNViewDialog
        grnId={viewGRNId}
        onOpenChange={(o) => !o && setViewGRNId(null)}
      />
      <VoucherViewDialog
        voucherId={viewVoucherId}
        onOpenChange={(o) => !o && setViewVoucherId(null)}
      />
      </div>
    </ERPLayout>
  );
}
