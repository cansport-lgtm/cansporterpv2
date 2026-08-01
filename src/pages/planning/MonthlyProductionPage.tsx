import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addMonths, endOfMonth, format, isSameMonth, startOfMonth, subMonths } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Factory,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ReportRow {
  planning_item_id: string;
  item_code: string;
  item_name: string;
  item_unit: string | null;
  department_name: string | null;
  opening_qty: number;
  opening_date: string | null;
  closing_qty: number | null;
  closing_date: string | null;
  dispatched_qty: number;
  returned_qty: number;
  derived_production: number | null;
}

interface UnmappedRow {
  product_id: string;
  product_code: string;
  product_name: string;
  dispatched_qty: number;
  returned_qty: number;
}

const fmtQty = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function MonthlyProductionPage() {
  const [month, setMonth] = useState<Date>(startOfMonth(new Date()));

  const fromStr = format(startOfMonth(month), "yyyy-MM-dd");
  const toStr = format(endOfMonth(month), "yyyy-MM-dd");
  const isCurrentMonth = isSameMonth(month, new Date());

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["monthly-production-report", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("production_monthly_report", {
        p_from: fromStr,
        p_to: toStr,
      });
      if (error) throw error;
      return (data || []) as ReportRow[];
    },
  });

  const { data: unmapped = [] } = useQuery({
    queryKey: ["monthly-production-unmapped", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("production_unmapped_sales", {
        p_from: fromStr,
        p_to: toStr,
      });
      if (error) throw error;
      return (data || []) as UnmappedRow[];
    },
  });

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        opening: acc.opening + Number(r.opening_qty || 0),
        closing: acc.closing + Number(r.closing_qty || 0),
        dispatched: acc.dispatched + Number(r.dispatched_qty || 0),
        returned: acc.returned + Number(r.returned_qty || 0),
        production: acc.production + Number(r.derived_production || 0),
      }),
      { opening: 0, closing: 0, dispatched: 0, returned: 0, production: 0 }
    );
  }, [rows]);

  const missingClosing = rows.filter((r) => r.closing_qty == null).length;
  const negativeRows = rows.filter(
    (r) => r.derived_production != null && Number(r.derived_production) < 0
  ).length;

  // Closing entered before the last day of the month is only approximate
  const isApproxClosing = (r: ReportRow) =>
    r.closing_date != null && r.closing_date !== toStr && !isCurrentMonth;

  const exportCSV = () => {
    const header = [
      "Department",
      "Code",
      "Item",
      "Unit",
      "Opening",
      "Dispatched",
      "Returns",
      "Closing",
      "Closing Date",
      "Production",
    ];
    const lines = rows.map((r) =>
      [
        r.department_name || "",
        r.item_code,
        `"${r.item_name.replace(/"/g, '""')}"`,
        r.item_unit || "",
        r.opening_qty,
        r.dispatched_qty,
        r.returned_qty,
        r.closing_qty ?? "",
        r.closing_date ?? "",
        r.derived_production ?? "",
      ].join(",")
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monthly-production-${format(month, "yyyy-MM")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const kpis = [
    { label: "Opening Stock", value: totals.opening },
    { label: "Production (Derived)", value: totals.production },
    { label: "Dispatched", value: totals.dispatched },
    { label: "Sales Returns", value: totals.returned },
    { label: "Closing Stock", value: totals.closing },
  ];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Monthly Production"
          description="Production derived from stock movement: Closing − Opening + Dispatches − Returns (in dozens)"
          icon={Factory}
          iconColor="bg-blue-500/10 text-blue-500"
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMonth((m) => subMonths(m, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[160px] text-center font-medium">
              {format(month, "MMMM yyyy")}
            </div>
            <Button
              variant="outline"
              size="icon"
              disabled={isCurrentMonth}
              onClick={() => setMonth((m) => addMonths(m, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" onClick={exportCSV} disabled={rows.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {kpis.map((k) => (
            <Card key={k.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {k.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{fmtQty(k.value)}</div>
                <div className="text-xs text-muted-foreground">dozens</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {unmapped.length > 0 && (
          <Card className="border-amber-500/50 bg-amber-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                {unmapped.length} product{unmapped.length > 1 ? "s" : ""} with sales this
                month {unmapped.length > 1 ? "are" : "is"} not linked to a planning item —
                these dispatches are missing from the production figures
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm space-y-1">
                {unmapped.map((u) => (
                  <div key={u.product_id} className="flex justify-between">
                    <span>
                      {u.product_code} — {u.product_name}
                    </span>
                    <span className="text-muted-foreground">
                      {fmtQty(u.dispatched_qty)} dz dispatched
                      {Number(u.returned_qty) > 0
                        ? `, ${fmtQty(u.returned_qty)} dz returned`
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Link them in Masters → Products / SKUs → "Linked Planning Item".
              </p>
            </CardContent>
          </Card>
        )}

        {(missingClosing > 0 || negativeRows > 0) && !isLoading && (
          <div className="flex flex-wrap gap-2 text-sm">
            {missingClosing > 0 && (
              <Badge variant="outline" className="text-amber-600 border-amber-500/50">
                {missingClosing} item{missingClosing > 1 ? "s" : ""} without a stock
                closing this month — production cannot be calculated for them
              </Badge>
            )}
            {negativeRows > 0 && (
              <Badge variant="outline" className="text-red-600 border-red-500/50">
                {negativeRows} item{negativeRows > 1 ? "s" : ""} with negative production
                — check closing entries and dispatches
              </Badge>
            )}
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="text-right">+ Dispatched</TableHead>
                  <TableHead className="text-right">− Returns</TableHead>
                  <TableHead className="text-right">Closing</TableHead>
                  <TableHead className="text-right">= Production</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      No stock closings or mapped sales found for{" "}
                      {format(month, "MMMM yyyy")}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {rows.map((r) => (
                      <TableRow key={r.planning_item_id}>
                        <TableCell className="text-muted-foreground">
                          {r.department_name || "—"}
                        </TableCell>
                        <TableCell>{r.item_code}</TableCell>
                        <TableCell>{r.item_name}</TableCell>
                        <TableCell className="text-right">
                          {fmtQty(r.opening_qty)}
                        </TableCell>
                        <TableCell className="text-right">
                          {fmtQty(r.dispatched_qty)}
                        </TableCell>
                        <TableCell className="text-right">
                          {fmtQty(r.returned_qty)}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.closing_qty == null ? (
                            <Badge
                              variant="outline"
                              className="text-amber-600 border-amber-500/50"
                            >
                              no closing
                            </Badge>
                          ) : (
                            <span>
                              {fmtQty(r.closing_qty)}
                              {isApproxClosing(r) && (
                                <span
                                  className="text-amber-600 text-xs ml-1"
                                  title={`Last closing on ${r.closing_date}, not month-end`}
                                >
                                  ~{format(new Date(r.closing_date!), "dd MMM")}
                                </span>
                              )}
                            </span>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-medium",
                            r.derived_production != null &&
                              Number(r.derived_production) < 0 &&
                              "text-red-600"
                          )}
                        >
                          {fmtQty(r.derived_production)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold bg-muted/50">
                      <TableCell colSpan={3}>Total</TableCell>
                      <TableCell className="text-right">{fmtQty(totals.opening)}</TableCell>
                      <TableCell className="text-right">
                        {fmtQty(totals.dispatched)}
                      </TableCell>
                      <TableCell className="text-right">{fmtQty(totals.returned)}</TableCell>
                      <TableCell className="text-right">{fmtQty(totals.closing)}</TableCell>
                      <TableCell className="text-right">
                        {fmtQty(totals.production)}
                      </TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Opening = last stock closing before the month. Closing = last stock closing
          within the month (marked ~ when it is not the month-end date). Dispatched and
          Returns come from the Sales module (posted returns only) for products linked to
          each planning item. All quantities in dozens.
        </p>
      </div>
    </ERPLayout>
  );
}
