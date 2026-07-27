import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ChevronLeft, ChevronRight, Package } from "lucide-react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";

// Receipts on/after this date come live from approved GRNs (Purchase module);
// earlier dates keep the manually entered stock-closing history. Must match
// consumption_grn_cutover() in the DB.
const GRN_RECEIPT_CUTOVER = "2026-07-27";

interface MaterialReceipt {
  raw_material_id: string;
  name: string;
  code: string;
  unit: string;
  category: string | null;
  priority: string | null;
  total_receipt: number;
  total_value: number;
  days_with_receipt: number;
  grn_count: number;
}

export default function MonthlyReceiptViewPage() {
  const { hasRole } = useAuth();
  const isMobile = useIsMobile();
  const isSuperAdmin = hasRole("super_admin");
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());

  const monthStart = format(startOfMonth(currentMonth), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(currentMonth), "yyyy-MM-dd");
  const grnStart = monthStart > GRN_RECEIPT_CUTOVER ? monthStart : GRN_RECEIPT_CUTOVER;
  const monthUsesGRN = monthEnd >= GRN_RECEIPT_CUTOVER;

  const { data, isLoading } = useQuery({
    queryKey: ["consumption-monthly-receipts", monthStart, monthEnd],
    queryFn: async () => {
      const [materialsRes, manualRes, grnRes, unmappedRes] = await Promise.all([
        supabase
          .from("consumption_raw_materials")
          .select("id, name, code, unit, cost_value, category, priority"),
        // Manual history strictly before the GRN cutover
        monthStart < GRN_RECEIPT_CUTOVER
          ? supabase
              .from("consumption_stock_closing")
              .select("raw_material_id, receipt_quantity, closing_date")
              .gte("closing_date", monthStart)
              .lte("closing_date", monthEnd)
              .lt("closing_date", GRN_RECEIPT_CUTOVER)
              .gt("receipt_quantity", 0)
          : Promise.resolve({ data: [], error: null }),
        // Live GRN receipts from the cutover onwards
        monthUsesGRN
          ? supabase
              .from("v_consumption_grn_receipts")
              .select("*")
              .gte("receipt_date", grnStart)
              .lte("receipt_date", monthEnd)
          : Promise.resolve({ data: [], error: null }),
        // Raw-material GRN lines that don't map to a consumption raw material
        monthUsesGRN
          ? supabase
              .from("v_consumption_grn_unmapped")
              .select("*")
              .gte("receipt_date", grnStart)
              .lte("receipt_date", monthEnd)
          : Promise.resolve({ data: [], error: null }),
      ]);

      for (const res of [materialsRes, manualRes, grnRes, unmappedRes]) {
        if (res.error) throw res.error;
      }

      const materials = new Map(
        (materialsRes.data || []).map((m) => [m.id, m])
      );

      const aggregated = new Map<string, MaterialReceipt & { dates: Set<string> }>();
      const getRow = (id: string) => {
        let row = aggregated.get(id);
        if (!row) {
          const mat = materials.get(id);
          row = {
            raw_material_id: id,
            name: mat?.name || "Unknown",
            code: mat?.code || "",
            unit: mat?.unit || "",
            category: mat?.category || null,
            priority: mat?.priority || null,
            total_receipt: 0,
            total_value: 0,
            days_with_receipt: 0,
            grn_count: 0,
            dates: new Set<string>(),
          };
          aggregated.set(id, row);
        }
        return row;
      };

      (manualRes.data || []).forEach((item: any) => {
        const qty = Number(item.receipt_quantity) || 0;
        if (qty <= 0) return;
        const row = getRow(item.raw_material_id);
        const mat = materials.get(item.raw_material_id);
        row.total_receipt += qty;
        row.total_value += qty * (Number(mat?.cost_value) || 0);
        row.dates.add(item.closing_date);
      });

      (grnRes.data || []).forEach((item: any) => {
        const qty = Number(item.receipt_quantity) || 0;
        if (qty <= 0 || !item.raw_material_id) return;
        const row = getRow(item.raw_material_id);
        row.total_receipt += qty;
        row.total_value += Number(item.receipt_amount) || 0;
        row.grn_count += Number(item.grn_count) || 0;
        row.dates.add(item.receipt_date);
      });

      const rows = Array.from(aggregated.values())
        .map(({ dates, ...row }) => ({ ...row, days_with_receipt: dates.size }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return { rows, unmapped: unmappedRes.data || [] };
    },
  });

  const receiptData = data?.rows;
  const unmapped = data?.unmapped || [];

  const totals = receiptData?.reduce(
    (acc, item) => {
      acc.totalReceipt += item.total_receipt;
      acc.totalValue += item.total_value;
      return acc;
    },
    { totalReceipt: 0, totalValue: 0 }
  ) || { totalReceipt: 0, totalValue: 0 };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="page-title">Monthly Receipt View</h1>
            <p className="page-description">Raw material receipts from approved GRNs, aggregated by month</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" className="min-w-[140px] justify-center font-medium">
              {format(currentMonth, "MMMM yyyy")}
            </Button>
            <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {unmapped.length > 0 && (
          <Card className="border-amber-500/50 bg-amber-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                {unmapped.length} GRN line{unmapped.length > 1 ? "s" : ""} not linked to a raw material
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1">
              <p>
                These received quantities are excluded from the totals below. Link the item to a
                raw material in the Items master to include them.
              </p>
              <ul className="list-disc list-inside">
                {unmapped.slice(0, 5).map((u: any) => (
                  <li key={u.grn_item_id}>
                    <span className="font-mono">{u.grn_number}</span> — {u.description || "No description"} ({Number(u.quantity_received).toFixed(2)})
                  </li>
                ))}
                {unmapped.length > 5 && <li>…and {unmapped.length - 5} more</li>}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" />
              Receipts for {format(currentMonth, "MMMM yyyy")}
              {receiptData && (
                <Badge variant="secondary" className="ml-2">{receiptData.length} materials</Badge>
              )}
              {monthUsesGRN && (
                <Badge variant="outline" className="ml-1">from GRN</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground text-center py-8">Loading...</p>
            ) : !receiptData?.length ? (
              <p className="text-muted-foreground text-center py-8">No receipts found for this month</p>
            ) : isMobile ? (
              <div className="space-y-3">
                {receiptData.map((item) => (
                  <Card key={item.raw_material_id} className="p-3">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold text-sm">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.code}</p>
                      </div>
                      {item.priority && (
                        <Badge variant={item.priority === "High" ? "destructive" : item.priority === "Medium" ? "default" : "secondary"} className="text-xs">
                          {item.priority}
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Receipt:</span>
                        <span className="font-medium">{item.total_receipt.toFixed(2)} {item.unit}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Days Received:</span>
                        <span>{item.days_with_receipt}</span>
                      </div>
                      {item.grn_count > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">GRNs:</span>
                          <span>{item.grn_count}</span>
                        </div>
                      )}
                      {item.category && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Category:</span>
                          <span>{item.category}</span>
                        </div>
                      )}
                      {isSuperAdmin && (
                        <>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Avg Cost/Unit:</span>
                            <span>{item.total_receipt > 0 ? (item.total_value / item.total_receipt).toFixed(2) : "-"}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Total Value:</span>
                            <span className="font-semibold text-primary">{item.total_value.toFixed(2)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </Card>
                ))}
                {/* Mobile totals */}
                <Card className="p-3 bg-muted/50 border-primary/20">
                  <p className="font-semibold text-sm mb-2">Totals</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Receipt Qty:</span>
                    <span className="font-bold">{totals.totalReceipt.toFixed(2)}</span>
                  </div>
                  {isSuperAdmin && (
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-muted-foreground">Total Value:</span>
                      <span className="font-bold text-primary">{totals.totalValue.toFixed(2)}</span>
                    </div>
                  )}
                </Card>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">#</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Material Name</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead className="text-right">Total Receipt</TableHead>
                      <TableHead className="text-right">Days Received</TableHead>
                      <TableHead className="text-right">GRNs</TableHead>
                      {isSuperAdmin && <TableHead className="text-right">Avg Cost/Unit</TableHead>}
                      {isSuperAdmin && <TableHead className="text-right">Total Value</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receiptData.map((item, index) => (
                      <TableRow key={item.raw_material_id}>
                        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                        <TableCell className="font-mono text-xs">{item.code}</TableCell>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell>{item.category || "-"}</TableCell>
                        <TableCell>
                          {item.priority ? (
                            <Badge variant={item.priority === "High" ? "destructive" : item.priority === "Medium" ? "default" : "secondary"}>
                              {item.priority}
                            </Badge>
                          ) : "-"}
                        </TableCell>
                        <TableCell className="text-right font-medium">{item.total_receipt.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{item.days_with_receipt}</TableCell>
                        <TableCell className="text-right">{item.grn_count || "-"}</TableCell>
                        {isSuperAdmin && (
                          <TableCell className="text-right">
                            {item.total_receipt > 0 ? (item.total_value / item.total_receipt).toFixed(2) : "-"}
                          </TableCell>
                        )}
                        {isSuperAdmin && (
                          <TableCell className="text-right font-semibold text-primary">
                            {item.total_value.toFixed(2)}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="font-bold">
                      <TableCell colSpan={6}>Total</TableCell>
                      <TableCell className="text-right">{totals.totalReceipt.toFixed(2)}</TableCell>
                      <TableCell />
                      <TableCell />
                      {isSuperAdmin && <TableCell />}
                      {isSuperAdmin && (
                        <TableCell className="text-right text-primary">{totals.totalValue.toFixed(2)}</TableCell>
                      )}
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
