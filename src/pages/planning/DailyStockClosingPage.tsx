import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar, Save, Package, Lock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface StockEntry {
  planning_item_id: string;
  item_code: string;
  item_name: string;
  unit: string;
  department_id: string;
  department_name: string;
  qty: number;
  multiplier: number;
  remarks: string;
  costing_value: number;
}

export default function DailyStockClosingPage() {
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [stockEntries, setStockEntries] = useState<Record<string, StockEntry>>({});
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  // Fetch planning items with department info
  const { data: planningItems } = useQuery({
    queryKey: ["planning-items-with-dept"],
    queryFn: async () => {
      const { data } = await supabase
        .from("planning_items")
        .select("*, production_departments(id, name)")
        .eq("is_active", true)
        .order("code");
      return data || [];
    },
  });

  // Fetch existing stock closing data for selected date
  const { data: existingData, isLoading } = useQuery({
    queryKey: ["daily-stock-closing", format(selectedDate, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data } = await supabase
        .from("daily_stock_closing")
        .select("*")
        .eq("closing_date", format(selectedDate, "yyyy-MM-dd"));
      return data || [];
    },
  });

  // Check if data already exists for selected date (entries have been saved before)
  const hasExistingData = existingData && existingData.length > 0;

  // Determine if fields should be locked (data exists and user is not super_admin)
  const isLocked = hasExistingData && !isSuperAdmin;

  // Initialize stock entries when data loads
  useMemo(() => {
    if (!planningItems) return;

    const entries: Record<string, StockEntry> = {};

    planningItems.forEach((item: any) => {
      const existing = existingData?.find((e: any) => e.planning_item_id === item.id);
      const unit = item.unit || "pcs";
      const closingDozens = Number(existing?.closing_quantity || 0);
      // Prefer saved entered_quantity & multiplier; fallback assumes multiplier=1
      const savedMultiplier = existing?.multiplier != null ? Number(existing.multiplier) : 1;
      const multiplier = savedMultiplier || 1;
      const qty = existing
        ? (existing.entered_quantity != null
            ? Number(existing.entered_quantity)
            : (multiplier ? closingDozens / multiplier : 0))
        : 0;

      entries[item.id] = {
        planning_item_id: item.id,
        item_code: item.code,
        item_name: item.name,
        unit,
        department_id: item.department_id,
        department_name: item.production_departments?.name || "Unknown",
        qty,
        multiplier,
        remarks: existing?.remarks || "",
        costing_value: item.costing_value || 0,
      };
    });

    setStockEntries(entries);
  }, [planningItems, existingData]);

  // Group items by department
  const itemsByDepartment = useMemo(() => {
    const grouped: Record<string, { departmentName: string; items: StockEntry[] }> = {};

    Object.values(stockEntries).forEach((entry) => {
      if (!grouped[entry.department_id]) {
        grouped[entry.department_id] = {
          departmentName: entry.department_name,
          items: [],
        };
      }
      grouped[entry.department_id].items.push(entry);
    });

    return grouped;
  }, [stockEntries]);

  // Update entry
  const handleEntryChange = (
    itemId: string,
    field: "qty" | "multiplier" | "remarks",
    value: string | number
  ) => {
    setStockEntries((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [field]: field === "remarks" ? value : Number(value) || 0,
      },
    }));
  };

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const dateStr = format(selectedDate, "yyyy-MM-dd");
      const entries = Object.values(stockEntries).map((entry) => ({
        closing_date: dateStr,
        department_id: entry.department_id,
        planning_item_id: entry.planning_item_id,
        entered_quantity: Number(entry.qty) || 0,
        multiplier: Number(entry.multiplier) || 0,
        closing_quantity: (Number(entry.qty) || 0) * (Number(entry.multiplier) || 0),
        remarks: entry.remarks || null,
      }));

      // Upsert all entries
      const { error } = await supabase
        .from("daily_stock_closing")
        .upsert(entries, {
          onConflict: "closing_date,planning_item_id",
        });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Stock closing data saved successfully");
      queryClient.invalidateQueries({ queryKey: ["daily-stock-closing"] });
    },
    onError: (error: any) => {
      toast.error("Failed to save: " + error.message);
    },
  });

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Daily Stock Closing"
          description="Enter end-of-day stock quantities for all planning items"
        />

        {/* Locked Data Warning */}
        {isLocked && (
          <Alert variant="destructive" className="bg-destructive/10 border-destructive/30 text-destructive">
            <Lock className="h-4 w-4" />
            <AlertDescription>
              Stock closing for {format(selectedDate, "dd MMM yyyy")} has already been entered and is now locked. Only Super Admin can edit or delete this data.
            </AlertDescription>
          </Alert>
        )}

        {/* Super Admin Edit Mode Notice */}
        {hasExistingData && isSuperAdmin && (
          <Alert className="bg-primary/10 border-primary/30 text-primary">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              You are editing existing stock closing data as Super Admin. Changes will be saved on click of "Save All".
            </AlertDescription>
          </Alert>
        )}

        {/* Date Selection */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <Label className="whitespace-nowrap">Closing Date:</Label>
                <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-[200px] justify-start text-left font-normal",
                        !selectedDate && "text-muted-foreground"
                      )}
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      {selectedDate ? format(selectedDate, "dd MMM yyyy") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => {
                        if (date) {
                          setSelectedDate(date);
                          setIsCalendarOpen(false);
                        }
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || isLoading || isLocked}
              >
                {isLocked ? (
                  <>
                    <Lock className="h-4 w-4 mr-2" />
                    Locked
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    {saveMutation.isPending ? "Saving..." : "Save All"}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Stock Entry by Department */}
        {isLoading ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Loading stock data...
            </CardContent>
          </Card>
        ) : Object.keys(itemsByDepartment).length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No planning items found. Add items in the Item Master first.</p>
            </CardContent>
          </Card>
        ) : (
          Object.entries(itemsByDepartment).map(([deptId, { departmentName, items }]) => (
            <Card key={deptId}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">{departmentName}</CardTitle>
              </CardHeader>
              <CardContent>
                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                  <p className="text-xs text-muted-foreground mb-2">
                    Closing Qty entered as <span className="font-medium">Qty × Multiplier</span>; result stored in <span className="font-medium">Dozens</span>.
                  </p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2 font-medium">Item Code</th>
                        <th className="text-left py-2 px-2 font-medium">Item Name</th>
                        <th className="text-left py-2 px-2 font-medium">Unit</th>
                        <th className="text-right py-2 px-2 font-medium">Qty</th>
                        <th className="text-right py-2 px-2 font-medium">× Mult</th>
                        <th className="text-right py-2 px-2 font-medium">= Dozens</th>
                        {isSuperAdmin && <th className="text-right py-2 px-2 font-medium">Stock Value</th>}
                        <th className="text-left py-2 px-2 font-medium">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const dozens = (Number(item.qty) || 0) * (Number(item.multiplier) || 0);
                        return (
                          <tr key={item.planning_item_id} className="border-b last:border-0">
                            <td className="py-2 px-2 font-medium">{item.item_code}</td>
                            <td className="py-2 px-2">{item.item_name}</td>
                            <td className="py-2 px-2 text-muted-foreground">{item.unit}</td>
                            <td className="py-2 px-2">
                              <Input
                                type="number"
                                min="0"
                                value={item.qty}
                                onChange={(e) =>
                                  handleEntryChange(item.planning_item_id, "qty", e.target.value)
                                }
                                disabled={isLocked}
                                className={cn("w-20 text-right ml-auto", isLocked && "bg-muted cursor-not-allowed")}
                              />
                            </td>
                            <td className="py-2 px-2">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.multiplier}
                                onChange={(e) =>
                                  handleEntryChange(item.planning_item_id, "multiplier", e.target.value)
                                }
                                disabled={isLocked}
                                className={cn("w-20 text-right ml-auto", isLocked && "bg-muted cursor-not-allowed")}
                              />
                            </td>
                            <td className="py-2 px-2 text-right font-medium">
                              {dozens.toFixed(2)}
                            </td>
                            {isSuperAdmin && (
                              <td className="py-2 px-2 text-right font-medium">
                                {(dozens * item.costing_value).toFixed(2)}
                              </td>
                            )}
                            <td className="py-2 px-2">
                              <Input
                                type="text"
                                value={item.remarks}
                                onChange={(e) =>
                                  handleEntryChange(item.planning_item_id, "remarks", e.target.value)
                                }
                                placeholder="Optional"
                                disabled={isLocked}
                                className={cn("w-full max-w-[200px]", isLocked && "bg-muted cursor-not-allowed")}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      {(() => {
                        const totalDozens = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.multiplier) || 0), 0);
                        const totalValue = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.multiplier) || 0) * (Number(it.costing_value) || 0), 0);
                        return (
                          <tr className="border-t bg-muted/40 font-semibold">
                            <td className="py-2 px-2" colSpan={5}>Department Total ({items.length} items)</td>
                            <td className="py-2 px-2 text-right">{totalDozens.toFixed(2)}</td>
                            {isSuperAdmin && <td className="py-2 px-2 text-right">{totalValue.toFixed(2)}</td>}
                            <td />
                          </tr>
                        );
                      })()}
                    </tfoot>
                  </table>
                </div>

                {/* Mobile Card View */}
                <div className="md:hidden space-y-4">
                  {items.map((item) => {
                    const dozens = (Number(item.qty) || 0) * (Number(item.multiplier) || 0);
                    return (
                      <div
                        key={item.planning_item_id}
                        className="border rounded-lg p-3 space-y-3"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium">{item.item_code}</div>
                            <div className="text-sm text-muted-foreground">{item.item_name}</div>
                          </div>
                          <span className="text-xs bg-muted px-2 py-1 rounded">{item.unit}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">Qty</Label>
                            <Input
                              type="number"
                              min="0"
                              value={item.qty}
                              onChange={(e) =>
                                handleEntryChange(item.planning_item_id, "qty", e.target.value)
                              }
                              disabled={isLocked}
                              className={cn("mt-1", isLocked && "bg-muted cursor-not-allowed")}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Multiplier</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.multiplier}
                              onChange={(e) =>
                                handleEntryChange(item.planning_item_id, "multiplier", e.target.value)
                              }
                              disabled={isLocked}
                              className={cn("mt-1", isLocked && "bg-muted cursor-not-allowed")}
                            />
                          </div>
                        </div>
                        <div className="text-right text-sm font-medium">
                          = {dozens.toFixed(2)} dozens
                        </div>
                        <div>
                          <Label className="text-xs">Remarks</Label>
                          <Input
                            type="text"
                            value={item.remarks}
                            onChange={(e) =>
                              handleEntryChange(item.planning_item_id, "remarks", e.target.value)
                            }
                            placeholder="Optional"
                            disabled={isLocked}
                            className={cn("mt-1", isLocked && "bg-muted cursor-not-allowed")}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {(() => {
                    const totalDozens = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.multiplier) || 0), 0);
                    const totalValue = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.multiplier) || 0) * (Number(it.costing_value) || 0), 0);
                    return (
                      <div className="border rounded-lg p-3 bg-muted/40 font-semibold flex justify-between">
                        <span>Total ({items.length} items)</span>
                        <span className="text-right">
                          {totalDozens.toFixed(2)} dz
                          {isSuperAdmin && <span className="block text-xs">Value: {totalValue.toFixed(2)}</span>}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </ERPLayout>
  );
}
