import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Upload, Download, Search, FileSpreadsheet, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import * as XLSX from "xlsx";

export default function AccountsReceivablePage() {
  const { hasRole } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const salesFileRef = useRef<HTMLInputElement>(null);
  const paymentsFileRef = useRef<HTMLInputElement>(null);
  const isSuperAdmin = hasRole("super_admin");

  const { data: salesData = [] } = useQuery({
    queryKey: ["ar-sales-imports"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ar_sales_imports").select("*");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: paymentsData = [] } = useQuery({
    queryKey: ["ar-payment-imports"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ar_payment_imports").select("*");
      if (error) throw error;
      return data || [];
    },
  });

  const getUniqueMonths = (rows: any[], dateField: string): string[] => {
    const months = new Set<string>();
    rows.forEach((r) => {
      const d = r[dateField];
      if (d) {
        const parsed = new Date(d);
        if (!isNaN(parsed.getTime())) {
          months.add(`${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`);
        }
      }
    });
    return Array.from(months);
  };

  const deleteByMonths = async (table: "ar_sales_imports" | "ar_payment_imports", dateCol: string, months: string[]) => {
    for (const m of months) {
      const [y, mo] = m.split("-").map(Number);
      const start = `${y}-${String(mo).padStart(2, "0")}-01`;
      const endDate = new Date(y, mo, 0); // last day of month
      const end = `${y}-${String(mo).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
      const { error } = await supabase.from(table).delete().gte(dateCol, start).lte(dateCol, end);
      if (error) throw error;
    }
  };

  const importSalesMutation = useMutation({
    mutationFn: async ({ rows, months }: { rows: any[]; months: string[] }) => {
      await deleteByMonths("ar_sales_imports", "invoice_date", months);
      const { error } = await supabase.from("ar_sales_imports").insert(rows);
      if (error) throw error;
      return months;
    },
    onSuccess: (months) => {
      queryClient.invalidateQueries({ queryKey: ["ar-sales-imports"] });
      toast.success(`Sales data replaced for ${months.join(", ")}`);
    },
    onError: (e: any) => toast.error("Import failed: " + e.message),
  });

  const importPaymentsMutation = useMutation({
    mutationFn: async ({ rows, months }: { rows: any[]; months: string[] }) => {
      await deleteByMonths("ar_payment_imports", "payment_date", months);
      const { error } = await supabase.from("ar_payment_imports").insert(rows);
      if (error) throw error;
      return months;
    },
    onSuccess: (months) => {
      queryClient.invalidateQueries({ queryKey: ["ar-payment-imports"] });
      toast.success(`Payment data replaced for ${months.join(", ")}`);
    },
    onError: (e: any) => toast.error("Import failed: " + e.message),
  });

  const clearSalesMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("ar_sales_imports").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ar-sales-imports"] });
      toast.success("Sales data cleared");
    },
  });

  const clearPaymentsMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("ar_payment_imports").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ar-payment-imports"] });
      toast.success("Payment data cleared");
    },
  });

  const handleFileUpload = (type: "sales" | "payments") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const jsonData: any[] = XLSX.utils.sheet_to_json(ws);

        if (type === "sales") {
          const rows = jsonData.map((r) => ({
            customer_name: String(r["Customer Name"] || r["customer_name"] || ""),
            invoice_number: String(r["Invoice Number"] || r["invoice_number"] || ""),
            invoice_date: r["Invoice Date"] || r["invoice_date"] || null,
            invoice_amount: Number(r["Invoice Amount"] || r["invoice_amount"] || 0),
            notes: r["Notes"] || r["notes"] || null,
          })).filter((r) => r.customer_name);
          if (!rows.length) { toast.error("No valid rows found"); return; }
          const months = getUniqueMonths(rows, "invoice_date");
          if (!months.length) { toast.error("No valid dates found in file"); return; }
          importSalesMutation.mutate({ rows, months });
        } else {
          const rows = jsonData.map((r) => ({
            customer_name: String(r["Customer Name"] || r["customer_name"] || ""),
            payment_date: r["Payment Date"] || r["payment_date"] || null,
            payment_amount: Number(r["Payment Amount"] || r["payment_amount"] || 0),
            reference_number: r["Reference Number"] || r["reference_number"] || null,
            payment_mode: r["Payment Mode"] || r["payment_mode"] || "cash",
            notes: r["Notes"] || r["notes"] || null,
          })).filter((r) => r.customer_name);
          if (!rows.length) { toast.error("No valid rows found"); return; }
          const months = getUniqueMonths(rows, "payment_date");
          if (!months.length) { toast.error("No valid dates found in file"); return; }
          importPaymentsMutation.mutate({ rows, months });
        }
      } catch {
        toast.error("Failed to parse Excel file");
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = "";
  };

  const downloadTemplate = (type: "sales" | "payments") => {
    const headers = type === "sales"
      ? [["Customer Name", "Invoice Number", "Invoice Date", "Invoice Amount", "Notes"]]
      : [["Customer Name", "Payment Date", "Payment Amount", "Reference Number", "Payment Mode", "Notes"]];
    const ws = XLSX.utils.aoa_to_sheet(headers);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, `ar_${type}_template.xlsx`);
  };

  const customerSummary = useMemo(() => {
    const map: Record<string, { invoiced: number; paid: number }> = {};
    salesData.forEach((s: any) => {
      const name = (s.customer_name || "").trim();
      if (!map[name]) map[name] = { invoiced: 0, paid: 0 };
      map[name].invoiced += Number(s.invoice_amount) || 0;
    });
    paymentsData.forEach((p: any) => {
      const name = (p.customer_name || "").trim();
      if (!map[name]) map[name] = { invoiced: 0, paid: 0 };
      map[name].paid += Number(p.payment_amount) || 0;
    });
    return Object.entries(map)
      .map(([name, v]) => ({ name, invoiced: v.invoiced, paid: v.paid, outstanding: v.invoiced - v.paid }))
      .sort((a, b) => b.outstanding - a.outstanding);
  }, [salesData, paymentsData]);

  const filtered = customerSummary.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  const totalInvoiced = customerSummary.reduce((s, c) => s + c.invoiced, 0);
  const totalPaid = customerSummary.reduce((s, c) => s + c.paid, 0);
  const totalOutstanding = totalInvoiced - totalPaid;

  const exportSummary = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map((c) => ({
      "Customer Name": c.name,
      "Total Invoiced": c.invoiced,
      "Total Paid": c.paid,
      "Outstanding": c.outstanding,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "AR Summary");
    XLSX.writeFile(wb, "accounts_receivable_summary.xlsx");
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Accounts Receivable" description="Customer outstanding balances from imported data" icon={DollarSign} iconColor="bg-emerald-100 text-emerald-700" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard title="Total Invoiced" value={`₹${totalInvoiced.toLocaleString()}`} icon={FileSpreadsheet} iconColor="text-blue-600" />
          <MetricCard title="Total Collected" value={`₹${totalPaid.toLocaleString()}`} icon={DollarSign} iconColor="text-green-600" />
          <MetricCard title="Total Outstanding" value={`₹${totalOutstanding.toLocaleString()}`} icon={DollarSign} iconColor="text-red-600" />
        </div>

        {isSuperAdmin && (
          <div className="flex flex-wrap gap-2">
            <input type="file" ref={salesFileRef} accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload("sales")} />
            <input type="file" ref={paymentsFileRef} accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload("payments")} />
            <Button onClick={() => salesFileRef.current?.click()} size="sm"><Upload className="h-4 w-4 mr-1" />Upload Sales Data</Button>
            <Button onClick={() => paymentsFileRef.current?.click()} size="sm" variant="outline"><Upload className="h-4 w-4 mr-1" />Upload Payments Data</Button>
            <Button onClick={() => downloadTemplate("sales")} size="sm" variant="ghost"><Download className="h-4 w-4 mr-1" />Sales Template</Button>
            <Button onClick={() => downloadTemplate("payments")} size="sm" variant="ghost"><Download className="h-4 w-4 mr-1" />Payments Template</Button>
            <Button onClick={() => clearSalesMutation.mutate()} size="sm" variant="destructive"><Trash2 className="h-4 w-4 mr-1" />Clear Sales</Button>
            <Button onClick={() => clearPaymentsMutation.mutate()} size="sm" variant="destructive"><Trash2 className="h-4 w-4 mr-1" />Clear Payments</Button>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search customer..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Button onClick={exportSummary} size="sm" variant="outline"><Download className="h-4 w-4 mr-1" />Export</Button>
        </div>

        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer Name</TableHead>
                <TableHead className="text-right">Total Invoiced</TableHead>
                <TableHead className="text-right">Total Paid</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No data. Upload sales & payment files to begin.</TableCell></TableRow>
              ) : filtered.map((c) => (
                <TableRow key={c.name}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-right">₹{c.invoiced.toLocaleString()}</TableCell>
                  <TableCell className="text-right">₹{c.paid.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-semibold">₹{c.outstanding.toLocaleString()}</TableCell>
                  <TableCell>
                    {c.outstanding <= 0 ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-700">Cleared</Badge>
                    ) : c.outstanding >= c.invoiced ? (
                      <Badge variant="destructive">Unpaid</Badge>
                    ) : (
                      <Badge variant="outline" className="border-orange-300 text-orange-600">Partial</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground">Sales records: {salesData.length} | Payment records: {paymentsData.length}</p>
      </div>
    </ERPLayout>
  );
}
