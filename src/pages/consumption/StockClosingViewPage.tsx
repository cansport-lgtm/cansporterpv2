import { useMemo, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertCircle, CalendarIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, isLastDayOfMonth, isMonday } from "date-fns";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";

export default function StockClosingViewPage() {
  const { hasRole } = useAuth();
  const isMobile = useIsMobile();
  const isSuperAdmin = hasRole("super_admin");
  const [filterMode, setFilterMode] = useState<"single" | "range">("single");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [isRangeCalendarOpen, setIsRangeCalendarOpen] = useState(false);

  const isRange = filterMode === "range";
  const rangeReady = Boolean(dateRange?.from && dateRange?.to);
  const fromStr = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "";
  const toStr = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : "";

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  // Weekly materials are due on Mondays and on the last day of the month.
  const weeklyDue = !isRange && (isMonday(selectedDate) || isLastDayOfMonth(selectedDate));

  const { data: closingData, isLoading } = useQuery({
    queryKey: ["consumption-stock-closing-view", dateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_stock_closing")
        .select(`
          *,
          raw_material:consumption_raw_materials(name, code, unit, cost_value, threshold)
        `)
        .eq("closing_date", dateStr)
        .order("created_at");
      if (error) throw error;
      return data || [];
    },
    enabled: !isRange,
  });

  const { data: rangeData, isLoading: isRangeLoading } = useQuery({
    queryKey: ["consumption-stock-closing-view-range", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_stock_closing")
        .select(`
          *,
          raw_material:consumption_raw_materials(name, code, unit, cost_value, threshold)
        `)
        .gte("closing_date", fromStr)
        .lte("closing_date", toStr)
        .order("closing_date");
      if (error) throw error;
      return data || [];
    },
    enabled: isRange && rangeReady,
  });

  // In range mode, aggregate entries per material: opening from the first day,
  // closing from the last day, receipts and consumption summed across the range.
  type AggregatedRow = {
    id: string;
    raw_material: { name: string; code: string; unit: string; cost_value: number; threshold: number } | null;
    opening_quantity: number;
    receipt_quantity: number;
    closing_quantity: number;
    actual_consumption: number;
    first_date: string;
    last_date: string;
  };

  const aggregatedRows = useMemo(() => {
    if (!isRange || !rangeData) return [];
    const byMaterial = new Map<string, AggregatedRow>();
    rangeData.forEach((item) => {
      const existing = byMaterial.get(item.raw_material_id);
      if (!existing) {
        byMaterial.set(item.raw_material_id, {
          id: item.raw_material_id,
          raw_material: item.raw_material,
          opening_quantity: Number(item.opening_quantity) || 0,
          receipt_quantity: Number(item.receipt_quantity) || 0,
          closing_quantity: Number(item.closing_quantity) || 0,
          actual_consumption: Number(item.actual_consumption) || 0,
          first_date: item.closing_date,
          last_date: item.closing_date,
        });
        return;
      }
      existing.receipt_quantity += Number(item.receipt_quantity) || 0;
      existing.actual_consumption += Number(item.actual_consumption) || 0;
      if (item.closing_date < existing.first_date) {
        existing.first_date = item.closing_date;
        existing.opening_quantity = Number(item.opening_quantity) || 0;
      }
      if (item.closing_date >= existing.last_date) {
        existing.last_date = item.closing_date;
        existing.closing_quantity = Number(item.closing_quantity) || 0;
      }
    });
    return Array.from(byMaterial.values()).sort((a, b) =>
      (a.raw_material?.code || "").localeCompare(b.raw_material?.code || "")
    );
  }, [isRange, rangeData]);

  const rows = isRange ? aggregatedRows : closingData || [];
  const loading = isRange ? rangeReady && isRangeLoading : isLoading;

  const { data: weeklyMaterials } = useQuery({
    queryKey: ["consumption-weekly-materials"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_raw_materials")
        .select("id, code, name, unit")
        .eq("is_active", true)
        .eq("closing_frequency", "weekly")
        .order("code");
      if (error) throw error;
      return data || [];
    },
    enabled: weeklyDue,
  });

  // Weekly materials due on this date but with no saved closing entry.
  const notPosted = useMemo(() => {
    if (!weeklyDue || !weeklyMaterials || closingData === undefined) return [];
    const posted = new Set((closingData || []).map((c: any) => c.raw_material_id));
    return weeklyMaterials.filter((m) => !posted.has(m.id));
  }, [weeklyDue, weeklyMaterials, closingData]);

  const periodLabel = isRange
    ? rangeReady
      ? `${format(dateRange!.from!, "MMM d, yyyy")} – ${format(dateRange!.to!, "MMM d, yyyy")}`
      : "Select a date range"
    : format(selectedDate, "MMMM d, yyyy");

  const totals = rows.reduce(
    (acc: any, item: any) => {
      const opening = Number(item.opening_quantity) || 0;
      const receipt = Number(item.receipt_quantity) || 0;
      const closing = Number(item.closing_quantity) || 0;
      const consumption = Number(item.actual_consumption) || 0;
      const costValue = item.raw_material?.cost_value || 0;
      const stockVal = closing * costValue;

      acc.opening += opening;
      acc.receipt += receipt;
      acc.closing += closing;
      acc.consumption += consumption;
      acc.stockValue += stockVal;
      return acc;
    },
    { opening: 0, receipt: 0, closing: 0, consumption: 0, stockValue: 0 }
  ) || { opening: 0, receipt: 0, closing: 0, consumption: 0, stockValue: 0 };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="page-title">Stock Closing View</h1>
            <p className="page-description">View daily stock closing with valuation</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filterMode} onValueChange={(v) => setFilterMode(v as "single" | "range")}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single Date</SelectItem>
                <SelectItem value="range">Custom Range</SelectItem>
              </SelectContent>
            </Select>
            {!isRange ? (
              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[200px] justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(selectedDate, "PPP")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => {
                      if (date) {
                        setSelectedDate(date);
                        setIsCalendarOpen(false);
                      }
                    }}
                    disabled={(date) => date > new Date()}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            ) : (
              <Popover open={isRangeCalendarOpen} onOpenChange={setIsRangeCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[260px] justify-start text-left font-normal",
                      !dateRange?.from && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange?.from
                      ? dateRange.to
                        ? `${format(dateRange.from, "dd MMM yyyy")} – ${format(dateRange.to, "dd MMM yyyy")}`
                        : format(dateRange.from, "dd MMM yyyy")
                      : "Pick a date range"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="range"
                    selected={dateRange}
                    onSelect={(range) => {
                      setDateRange(range);
                      if (range?.from && range?.to) setIsRangeCalendarOpen(false);
                    }}
                    numberOfMonths={isMobile ? 1 : 2}
                    disabled={(date) => date > new Date()}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>

        {notPosted.length > 0 && (
          <Card className="border-amber-500/50 bg-amber-500/5">
            <CardContent className="flex items-start gap-2 p-3 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <span>
                {notPosted.length} weekly material{notPosted.length > 1 ? "s are" : " is"} due on this
                date but ha{notPosted.length > 1 ? "ve" : "s"} no closing entry — shown below as "Not
                posted". Enter them via Stock Closing for {format(selectedDate, "dd MMM")}.
              </span>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Stock Closing — {periodLabel}</CardTitle>
            {isRange && rangeReady && (
              <p className="text-sm text-muted-foreground">
                Opening is taken from each material's first entry in the range, closing from its last;
                receipts and consumption are summed across the range.
              </p>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {/* Desktop Table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right">Receipts</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                    <TableHead className="text-right">Consumption</TableHead>
                    <TableHead className="text-right">Threshold</TableHead>
                    {isSuperAdmin && <TableHead className="text-right">Cost/Unit</TableHead>}
                    {isSuperAdmin && <TableHead className="text-right">Stock Value</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={isSuperAdmin ? 10 : 8} className="text-center">Loading...</TableCell>
                    </TableRow>
                  ) : isRange && !rangeReady ? (
                    <TableRow>
                      <TableCell colSpan={isSuperAdmin ? 10 : 8} className="text-center text-muted-foreground">
                        Select a start and end date to view stock closing.
                      </TableCell>
                    </TableRow>
                  ) : rows.length === 0 && notPosted.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isSuperAdmin ? 10 : 8} className="text-center text-muted-foreground">
                        {isRange ? "No stock closing entries in this date range." : "No stock closing entries for this date."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((item: any) => {
                      const closing = Number(item.closing_quantity) || 0;
                      const costValue = item.raw_material?.cost_value || 0;
                      const threshold = Number(item.raw_material?.threshold) || 0;
                      const stockVal = closing * costValue;
                      const isBelowThreshold = threshold > 0 && closing < threshold;
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono">{item.raw_material?.code}</TableCell>
                          <TableCell className="font-medium">{item.raw_material?.name}</TableCell>
                          <TableCell>{item.raw_material?.unit}</TableCell>
                          <TableCell className="text-right">{Number(item.opening_quantity).toFixed(2)}</TableCell>
                          <TableCell className="text-right">{Number(item.receipt_quantity).toFixed(2)}</TableCell>
                          <TableCell className="text-right">{closing.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-semibold">{Number(item.actual_consumption).toFixed(2)}</TableCell>
                          <TableCell className={cn("text-right", isBelowThreshold && "text-destructive font-semibold")}>{threshold > 0 ? threshold.toFixed(2) : "—"}</TableCell>
                          {isSuperAdmin && <TableCell className="text-right">{costValue.toFixed(2)}</TableCell>}
                          {isSuperAdmin && <TableCell className="text-right font-semibold">{stockVal.toFixed(2)}</TableCell>}
                        </TableRow>
                      );
                    })
                  )}
                  {!loading &&
                    notPosted.map((m) => (
                      <TableRow key={`np-${m.id}`} className="bg-muted/30 hover:bg-muted/30">
                        <TableCell className="font-mono text-muted-foreground">{m.code}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {m.name}
                          <span className="ml-2 inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-400">
                            Not posted
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{m.unit}</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        {isSuperAdmin && <TableCell className="text-right text-muted-foreground">—</TableCell>}
                        {isSuperAdmin && <TableCell className="text-right text-muted-foreground">—</TableCell>}
                      </TableRow>
                    ))}
                </TableBody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 font-semibold bg-muted/50">
                      <td className="py-2 px-4" colSpan={3}>Total</td>
                      <td className="py-2 px-4 text-right">{totals.opening.toFixed(2)}</td>
                      <td className="py-2 px-4 text-right">{totals.receipt.toFixed(2)}</td>
                      <td className="py-2 px-4 text-right">{totals.closing.toFixed(2)}</td>
                      <td className="py-2 px-4 text-right">{totals.consumption.toFixed(2)}</td>
                      <td className="py-2 px-4 text-right">—</td>
                      {isSuperAdmin && <td className="py-2 px-4 text-right">—</td>}
                      {isSuperAdmin && <td className="py-2 px-4 text-right font-bold">{totals.stockValue.toFixed(2)}</td>}
                    </tr>
                  </tfoot>
                )}
              </Table>
            </div>

            {/* Mobile Card List */}
            <div className="md:hidden divide-y">
              {loading ? (
                <div className="p-4 text-center text-muted-foreground">Loading...</div>
              ) : isRange && !rangeReady ? (
                <div className="p-4 text-center text-muted-foreground">Select a start and end date.</div>
              ) : rows.length === 0 && notPosted.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">
                  {isRange ? "No entries in this date range." : "No entries for this date."}
                </div>
              ) : (
                <>
                  {rows.map((item: any) => {
                    const closing = Number(item.closing_quantity) || 0;
                    const costValue = item.raw_material?.cost_value || 0;
                    const stockVal = closing * costValue;
                    return (
                      <div key={item.id} className="p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{item.raw_material?.name}</span>
                          <span className="text-xs font-mono text-muted-foreground">{item.raw_material?.code}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Opening:</span>
                            <span>{Number(item.opening_quantity).toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Receipts:</span>
                            <span>{Number(item.receipt_quantity).toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Closing:</span>
                            <span className="font-medium">{closing.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Consumed:</span>
                            <span className="font-semibold">{Number(item.actual_consumption).toFixed(2)}</span>
                          </div>
                          {isSuperAdmin && (
                            <div className="flex justify-between col-span-2 pt-1 border-t border-border/50">
                              <span className="text-muted-foreground">Stock Value:</span>
                              <span className="font-bold">₹{stockVal.toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {notPosted.map((m) => (
                    <div key={`np-${m.id}`} className="p-3 flex items-center justify-between bg-muted/30">
                      <div>
                        <span className="text-muted-foreground font-medium">{m.name}</span>
                        <span className="ml-2 text-xs font-mono text-muted-foreground">{m.code}</span>
                      </div>
                      <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-400">
                        Not posted
                      </span>
                    </div>
                  ))}
                  {/* Mobile Totals */}
                  {rows.length > 0 && (
                  <div className="p-3 bg-muted/50 space-y-1">
                    <div className="font-semibold text-sm">Totals</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Opening:</span>
                        <span className="font-semibold">{totals.opening.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Receipts:</span>
                        <span className="font-semibold">{totals.receipt.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Closing:</span>
                        <span className="font-semibold">{totals.closing.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Consumed:</span>
                        <span className="font-semibold">{totals.consumption.toFixed(2)}</span>
                      </div>
                      {isSuperAdmin && (
                        <div className="flex justify-between col-span-2 pt-1 border-t border-border/50">
                          <span className="text-muted-foreground">Total Stock Value:</span>
                          <span className="font-bold">₹{totals.stockValue.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
