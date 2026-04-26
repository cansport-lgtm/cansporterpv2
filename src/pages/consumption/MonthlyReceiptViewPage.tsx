import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, ChevronRight, Package } from "lucide-react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";

export default function MonthlyReceiptViewPage() {
  const { hasRole } = useAuth();
  const isMobile = useIsMobile();
  const isSuperAdmin = hasRole("super_admin");
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());

  const monthStart = format(startOfMonth(currentMonth), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(currentMonth), "yyyy-MM-dd");

  const { data: receiptData, isLoading } = useQuery({
    queryKey: ["consumption-monthly-receipts", monthStart, monthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_stock_closing")
        .select(`
          *,
          raw_material:consumption_raw_materials(name, code, unit, cost_value, category, priority)
        `)
        .gte("closing_date", monthStart)
        .lte("closing_date", monthEnd)
        .order("closing_date");
      if (error) throw error;

      // Aggregate by raw_material_id
      const aggregated = new Map<string, {
        raw_material_id: string;
        name: string;
        code: string;
        unit: string;
        cost_value: number;
        category: string | null;
        priority: string | null;
        total_receipt: number;
        days_with_receipt: number;
      }>();

      (data || []).forEach((item: any) => {
        const receipt = Number(item.receipt_quantity) || 0;
        if (receipt <= 0) return;

        const id = item.raw_material_id;
        if (aggregated.has(id)) {
          const existing = aggregated.get(id)!;
          existing.total_receipt += receipt;
          existing.days_with_receipt += 1;
        } else {
          aggregated.set(id, {
            raw_material_id: id,
            name: item.raw_material?.name || "Unknown",
            code: item.raw_material?.code || "",
            unit: item.raw_material?.unit || "",
            cost_value: item.raw_material?.cost_value || 0,
            category: item.raw_material?.category || null,
            priority: item.raw_material?.priority || null,
            total_receipt: receipt,
            days_with_receipt: 1,
          });
        }
      });

      return Array.from(aggregated.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const totals = receiptData?.reduce(
    (acc, item) => {
      acc.totalReceipt += item.total_receipt;
      acc.totalValue += item.total_receipt * item.cost_value;
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
            <p className="page-description">Raw material receipts aggregated by month</p>
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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" />
              Receipts for {format(currentMonth, "MMMM yyyy")}
              {receiptData && (
                <Badge variant="secondary" className="ml-2">{receiptData.length} materials</Badge>
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
                      {item.category && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Category:</span>
                          <span>{item.category}</span>
                        </div>
                      )}
                      {isSuperAdmin && (
                        <>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Cost/Unit:</span>
                            <span>{item.cost_value.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Total Value:</span>
                            <span className="font-semibold text-primary">{(item.total_receipt * item.cost_value).toFixed(2)}</span>
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
                      {isSuperAdmin && <TableHead className="text-right">Cost/Unit</TableHead>}
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
                        {isSuperAdmin && <TableCell className="text-right">{item.cost_value.toFixed(2)}</TableCell>}
                        {isSuperAdmin && (
                          <TableCell className="text-right font-semibold text-primary">
                            {(item.total_receipt * item.cost_value).toFixed(2)}
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
