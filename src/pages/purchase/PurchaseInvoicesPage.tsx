import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Search, Eye } from "lucide-react";
import { format, startOfMonth, parseISO } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { GRNViewDialog } from "@/components/purchase/GRNViewDialog";

type PurchaseCategory = "raw_material" | "office_supplies" | "general_supplies" | "spare_maintenance";

const sb = supabase as any;

export default function PurchaseInvoicesPage() {
  const { hasPurchaseCategoryPermission } = useAuth();
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [search, setSearch] = useState("");
  const [viewGRNId, setViewGRNId] = useState<string | null>(null);

  // Purchase invoices = goods receipt notes (they carry the supplier invoice no./amount).
  const { data: grns = [], isLoading } = useQuery({
    queryKey: ["purchase-invoices", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await sb
        .from("goods_receipt_notes")
        .select(`id, grn_number, receipt_date, invoice_number, invoice_date, invoice_amount, total_amount, status,
                 suppliers(name, code), purchase_orders(po_number, category)`)
        .gte("receipt_date", fromDate)
        .lte("receipt_date", toDate)
        .order("receipt_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const grnIds = useMemo(() => grns.map((g: any) => g.id), [grns]);

  // GL voucher posted per GRN (source_module='purchase')
  const { data: vouchers = {} } = useQuery({
    queryKey: ["purchase-invoices-vouchers", grnIds.join(",")],
    queryFn: async () => {
      if (!grnIds.length) return {};
      const { data, error } = await sb
        .from("accounting_vouchers")
        .select("voucher_number, source_reference_id")
        .eq("source_module", "purchase")
        .in("source_reference_id", grnIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data || []).forEach((v: any) => { map[v.source_reference_id] = v.voucher_number; });
      return map;
    },
    enabled: grnIds.length > 0,
  });

  const canViewCategory = (category: string | null | undefined) =>
    !!category && hasPurchaseCategoryPermission(category as PurchaseCategory, "view");

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return grns
      .filter((g: any) => canViewCategory(g.purchase_orders?.category))
      .filter((g: any) => {
        if (!term) return true;
        return (
          (g.invoice_number || "").toLowerCase().includes(term) ||
          (g.grn_number || "").toLowerCase().includes(term) ||
          (g.suppliers?.name || "").toLowerCase().includes(term) ||
          (g.purchase_orders?.po_number || "").toLowerCase().includes(term)
        );
      });
  }, [grns, search, hasPurchaseCategoryPermission]);

  const totalInvoiced = rows.reduce((s: number, g: any) => s + Number(g.invoice_amount || g.total_amount || 0), 0);
  const postedCount = rows.filter((g: any) => (vouchers as any)[g.id]).length;
  const unpostedCount = rows.length - postedCount;

  return (
    <ERPLayout>
      <PageHeader
        title="Purchase Invoices"
        description="Supplier invoices captured against goods receipts — view, edit prices, and check GL posting."
        icon={FileText}
        iconColor="bg-indigo-500/10 text-indigo-500"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Invoices</div>
          <div className="text-lg font-semibold">{rows.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Total Invoiced</div>
          <div className="text-lg font-semibold">Rs. {totalInvoiced.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Posted to GL</div>
          <div className="text-lg font-semibold text-green-600">{postedCount}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Not Posted</div>
          <div className={`text-lg font-semibold ${unpostedCount === 0 ? "text-green-600" : "text-amber-600"}`}>{unpostedCount}</div>
        </CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search invoice #, supplier, GRN, PO…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 w-72" />
        </div>
        <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[160px]" />
        <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[160px]" />
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <Table className="min-w-[980px]">
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>GRN #</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>PO #</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Invoice Date</TableHead>
              <TableHead className="text-right">Invoice Amt</TableHead>
              <TableHead className="text-right">Total Received</TableHead>
              <TableHead>GL Voucher</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>}
            {!isLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No purchase invoices in this range</TableCell></TableRow>
            )}
            {rows.map((g: any) => (
              <TableRow key={g.id}>
                <TableCell className="font-mono text-xs">{g.invoice_number || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="font-mono text-xs">{g.grn_number}</TableCell>
                <TableCell className="text-xs">{g.suppliers?.name || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{g.purchase_orders?.po_number || "—"}</TableCell>
                <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{g.purchase_orders?.category || "—"}</Badge></TableCell>
                <TableCell className="text-xs">{g.invoice_date ? format(parseISO(g.invoice_date), "dd MMM yyyy") : (g.receipt_date ? format(parseISO(g.receipt_date), "dd MMM yyyy") : "—")}</TableCell>
                <TableCell className="text-right text-xs">{g.invoice_amount != null ? `Rs. ${Number(g.invoice_amount).toLocaleString()}` : "—"}</TableCell>
                <TableCell className="text-right text-xs">Rs. {Number(g.total_amount || 0).toLocaleString()}</TableCell>
                <TableCell className="text-xs">
                  {(vouchers as any)[g.id]
                    ? <Badge variant="default" className="bg-green-600 font-mono text-[10px]">{(vouchers as any)[g.id]}</Badge>
                    : <Badge variant="secondary" className="text-[10px]">Not posted</Badge>}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewGRNId(g.id)} title="View / edit prices">
                    <Eye className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <GRNViewDialog grnId={viewGRNId} onOpenChange={(open) => { if (!open) setViewGRNId(null); }} />
    </ERPLayout>
  );
}
