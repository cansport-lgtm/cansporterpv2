import { useState, useEffect } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Save, CalendarIcon, ChevronDown, ChevronRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface StockEntry {
  raw_material_id: string;
  code: string;
  name: string;
  unit: string;
  category: string;
  opening_quantity: string;
  receipt_quantity: string;
  closing_quantity: string;
  existingId?: string;
}

// From this date receipts are sourced from approved GRNs (Purchase module)
// and are read-only here. Must match consumption_grn_cutover() in the DB.
const GRN_RECEIPT_CUTOVER = "2026-07-27";

export default function StockClosingPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [entries, setEntries] = useState<StockEntry[]>([]);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const prevDateStr = format(subDays(selectedDate, 1), "yyyy-MM-dd");
  const receiptsFromGRN = dateStr >= GRN_RECEIPT_CUTOVER;

  const { data: rawMaterials } = useQuery({
    queryKey: ["consumption-raw-materials-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_raw_materials")
        .select("id, code, name, unit, category")
        .eq("is_active", true)
        .order("category")
        .order("code");
      if (error) throw error;
      return data;
    },
  });

  const { data: previousClosing } = useQuery({
    queryKey: ["consumption-previous-closing", prevDateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_stock_closing")
        .select("raw_material_id, closing_quantity")
        .eq("closing_date", prevDateStr);
      if (error) throw error;
      return data?.reduce((acc: Record<string, number>, item) => {
        acc[item.raw_material_id] = Number(item.closing_quantity);
        return acc;
      }, {});
    },
    enabled: !!rawMaterials,
  });

  const { data: grnReceipts } = useQuery({
    queryKey: ["consumption-grn-receipts", dateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_consumption_grn_receipts")
        .select("raw_material_id, receipt_quantity")
        .eq("receipt_date", dateStr);
      if (error) throw error;
      return (data || []).reduce((acc: Record<string, number>, r) => {
        if (r.raw_material_id) acc[r.raw_material_id] = Number(r.receipt_quantity) || 0;
        return acc;
      }, {});
    },
    enabled: receiptsFromGRN,
  });

  const { data: existingEntries, isLoading } = useQuery({
    queryKey: ["consumption-stock-closing", dateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_stock_closing")
        .select("*")
        .eq("closing_date", dateStr);
      if (error) throw error;
      return data;
    },
    enabled: !!rawMaterials,
  });

  // Build entries when data loads
  useEffect(() => {
    if (
      rawMaterials &&
      existingEntries !== undefined &&
      previousClosing !== undefined &&
      (!receiptsFromGRN || grnReceipts !== undefined)
    ) {
      const newEntries: StockEntry[] = rawMaterials.map((mat) => {
        const existing = existingEntries?.find((e) => e.raw_material_id === mat.id);
        const prevClose = previousClosing?.[mat.id] || 0;
        return {
          raw_material_id: mat.id,
          code: mat.code,
          name: mat.name,
          unit: mat.unit,
          category: mat.category || "Uncategorized",
          opening_quantity: existing ? String(existing.opening_quantity) : String(prevClose),
          receipt_quantity: receiptsFromGRN
            ? String(grnReceipts?.[mat.id] ?? 0)
            : existing
              ? String(existing.receipt_quantity)
              : "0",
          closing_quantity: existing ? String(existing.closing_quantity) : "",
          existingId: existing?.id,
        };
      });
      setEntries(newEntries);
    }
  }, [rawMaterials, existingEntries, previousClosing, grnReceipts, receiptsFromGRN]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const toUpsert = entries
        .filter((e) => e.closing_quantity !== "")
        .map((e) => ({
          id: e.existingId,
          closing_date: dateStr,
          raw_material_id: e.raw_material_id,
          opening_quantity: parseFloat(e.opening_quantity) || 0,
          receipt_quantity: parseFloat(e.receipt_quantity) || 0,
          closing_quantity: parseFloat(e.closing_quantity) || 0,
          created_by: user?.id,
        }));

      for (const entry of toUpsert) {
        if (entry.id) {
          const { error } = await supabase
            .from("consumption_stock_closing")
            .update({
              opening_quantity: entry.opening_quantity,
              receipt_quantity: entry.receipt_quantity,
              closing_quantity: entry.closing_quantity,
            })
            .eq("id", entry.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("consumption_stock_closing")
            .insert({
              closing_date: entry.closing_date,
              raw_material_id: entry.raw_material_id,
              opening_quantity: entry.opening_quantity,
              receipt_quantity: entry.receipt_quantity,
              closing_quantity: entry.closing_quantity,
              created_by: entry.created_by,
            });
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumption-stock-closing"] });
      toast.success("Stock closing saved");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save");
    },
  });

  const updateEntry = (idx: number, field: keyof StockEntry, value: string) => {
    const newEntries = [...entries];
    newEntries[idx] = { ...newEntries[idx], [field]: value };
    setEntries(newEntries);
  };

  const calculateConsumption = (entry: StockEntry) => {
    const opening = parseFloat(entry.opening_quantity) || 0;
    const receipt = parseFloat(entry.receipt_quantity) || 0;
    const closing = parseFloat(entry.closing_quantity) || 0;
    if (entry.closing_quantity === "") return "-";
    return (opening + receipt - closing).toFixed(2);
  };

  const toggleCategory = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Group entries by category
  const groupedEntries = entries.reduce<Record<string, { entries: StockEntry[]; indices: number[] }>>((acc, entry, idx) => {
    const cat = entry.category;
    if (!acc[cat]) acc[cat] = { entries: [], indices: [] };
    acc[cat].entries.push(entry);
    acc[cat].indices.push(idx);
    return acc;
  }, {});

  const categoryNames = Object.keys(groupedEntries).sort((a, b) => {
    if (a === "Uncategorized") return 1;
    if (b === "Uncategorized") return -1;
    return a.localeCompare(b);
  });

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="page-title">Daily Stock Closing</h1>
            <p className="page-description">
              Record daily closing stock for raw materials
              {receiptsFromGRN && " — receipts are auto-filled from approved GRNs (Purchase module)"}
            </p>
          </div>
          <div className="flex gap-2 items-center">
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
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              <Save className="mr-2 h-4 w-4" />
              {saveMutation.isPending ? "Saving..." : "Save All"}
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Stock Closing for {format(selectedDate, "MMMM d, yyyy")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="text-right">
                    Receipts{receiptsFromGRN && <span className="block text-[10px] font-normal text-muted-foreground">from GRN</span>}
                  </TableHead>
                  <TableHead className="text-right">Closing</TableHead>
                  <TableHead className="text-right">Consumption</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center">Loading...</TableCell>
                  </TableRow>
                ) : entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      No raw materials found. Add materials first.
                    </TableCell>
                  </TableRow>
                ) : (
                  categoryNames.map((category) => {
                    const group = groupedEntries[category];
                    const isCollapsed = collapsedCategories.has(category);
                    return (
                      <CategoryGroup
                        key={category}
                        category={category}
                        entries={group.entries}
                        indices={group.indices}
                        isCollapsed={isCollapsed}
                        onToggle={() => toggleCategory(category)}
                        onUpdateEntry={updateEntry}
                        calculateConsumption={calculateConsumption}
                        receiptsReadOnly={receiptsFromGRN}
                      />
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}

function CategoryGroup({
  category,
  entries,
  indices,
  isCollapsed,
  onToggle,
  onUpdateEntry,
  calculateConsumption,
  receiptsReadOnly,
}: {
  category: string;
  entries: StockEntry[];
  indices: number[];
  isCollapsed: boolean;
  onToggle: () => void;
  onUpdateEntry: (idx: number, field: keyof StockEntry, value: string) => void;
  calculateConsumption: (entry: StockEntry) => string;
  receiptsReadOnly: boolean;
}) {
  return (
    <>
      <TableRow
        className="bg-muted/50 cursor-pointer hover:bg-muted"
        onClick={onToggle}
      >
        <TableCell colSpan={7}>
          <div className="flex items-center gap-2 font-semibold">
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            {category}
            <span className="text-muted-foreground font-normal text-sm">
              ({entries.length} items)
            </span>
          </div>
        </TableCell>
      </TableRow>
      {!isCollapsed &&
        entries.map((entry, i) => (
          <TableRow key={entry.raw_material_id}>
            <TableCell className="font-mono">{entry.code}</TableCell>
            <TableCell className="font-medium">{entry.name}</TableCell>
            <TableCell>{entry.unit}</TableCell>
            <TableCell className="text-right">
              <Input
                type="number"
                step="0.01"
                className="w-24 text-right ml-auto"
                value={entry.opening_quantity}
                onChange={(e) => onUpdateEntry(indices[i], "opening_quantity", e.target.value)}
              />
            </TableCell>
            <TableCell className="text-right">
              {receiptsReadOnly ? (
                <span className="inline-block w-24 text-right font-medium tabular-nums">
                  {(parseFloat(entry.receipt_quantity) || 0).toFixed(2)}
                </span>
              ) : (
                <Input
                  type="number"
                  step="0.01"
                  className="w-24 text-right ml-auto"
                  value={entry.receipt_quantity}
                  onChange={(e) => onUpdateEntry(indices[i], "receipt_quantity", e.target.value)}
                />
              )}
            </TableCell>
            <TableCell className="text-right">
              <Input
                type="number"
                step="0.01"
                className="w-24 text-right ml-auto"
                value={entry.closing_quantity}
                onChange={(e) => onUpdateEntry(indices[i], "closing_quantity", e.target.value)}
                placeholder="Enter"
              />
            </TableCell>
            <TableCell className="text-right font-semibold">
              {calculateConsumption(entry)} {entry.closing_quantity !== "" ? entry.unit : ""}
            </TableCell>
          </TableRow>
        ))}
    </>
  );
}
