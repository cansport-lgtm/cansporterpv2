import { useMemo, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertCircle, CalendarIcon, Printer, Search } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { differenceInCalendarDays, format, parseISO, subDays } from "date-fns";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { esc, printDocument } from "@/lib/printDocument";
import {
  MATERIAL_VALUE_CATEGORIES,
  materialValueCategoryCode,
  materialValueCategoryLabel,
  type MaterialValueCategory,
} from "@/lib/materialValueCategory";

// Stock is read from the latest closing within this window; materials with no
// closing in it are reported separately instead of being guessed at.
const STOCK_LOOKBACK_DAYS = 90;
// Average daily use is measured over this many days ending on the "as of" date.
const USAGE_WINDOW_DAYS = 30;
// A closing older than this is flagged as stale.
const STALE_DAYS = 7;
// "Near threshold" includes stock up to this multiple of the threshold.
const NEAR_FACTOR = 1.2;

type Status = "out" | "below" | "near";

const STATUS_META: Record<Status, { label: string; rank: number }> = {
  out: { label: "Out of stock", rank: 0 },
  below: { label: "Below threshold", rank: 1 },
  near: { label: "Near threshold", rank: 2 },
};

interface Material {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  threshold: number | null;
  cost_value: number | null;
  priority: string | null;
  value_category: MaterialValueCategory | null;
}

interface ReorderRow {
  material: Material;
  stock: number;
  lastClosing: string;
  daysSinceClosing: number;
  threshold: number;
  avgDaily: number;
  daysLeft: number | null;
  suggested: number;
  rate: number;
  status: Status;
}

async function fetchClosingRows(from: string, to: string) {
  const pageSize = 1000;
  const all: { raw_material_id: string; closing_date: string; closing_quantity: number; actual_consumption: number | null }[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("consumption_stock_closing")
      .select("raw_material_id, closing_date, closing_quantity, actual_consumption")
      .gte("closing_date", from)
      .lte("closing_date", to)
      .order("closing_date")
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return all;
}

const fmtNum = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function ReorderRequirementPage() {
  const { hasRole } = useAuth();
  // Rates and values follow the stock-closing pages: visible to super admins only.
  const showValue = hasRole("super_admin");

  const [asOfDate, setAsOfDate] = useState<Date>(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [coverDays, setCoverDays] = useState<string>("30");
  const [includeNear, setIncludeNear] = useState(false);
  const [tierFilter, setTierFilter] = useState<MaterialValueCategory | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});

  const asOfStr = format(asOfDate, "yyyy-MM-dd");
  const lookbackStart = format(subDays(asOfDate, STOCK_LOOKBACK_DAYS), "yyyy-MM-dd");
  const usageStart = format(subDays(asOfDate, USAGE_WINDOW_DAYS - 1), "yyyy-MM-dd");
  const cover = Math.max(0, Number(coverDays) || 0);

  const { data: materials, isLoading: materialsLoading } = useQuery({
    queryKey: ["reorder-materials"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_raw_materials")
        .select("id, code, name, unit, threshold, cost_value, priority, value_category")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return (data || []) as Material[];
    },
  });

  const { data: closingRows, isLoading: closingLoading } = useQuery({
    queryKey: ["reorder-closings", lookbackStart, asOfStr],
    queryFn: () => fetchClosingRows(lookbackStart, asOfStr),
  });

  // Latest closing + recent usage per material (rows arrive date-ascending).
  const stockByMaterial = useMemo(() => {
    const map = new Map<string, { stock: number; lastClosing: string; used: number }>();
    (closingRows || []).forEach((r) => {
      const entry = map.get(r.raw_material_id) || { stock: 0, lastClosing: r.closing_date, used: 0 };
      entry.stock = Number(r.closing_quantity) || 0;
      entry.lastClosing = r.closing_date;
      if (r.closing_date >= usageStart) entry.used += Number(r.actual_consumption) || 0;
      map.set(r.raw_material_id, entry);
    });
    return map;
  }, [closingRows, usageStart]);

  const { rows, noThresholdCount, noClosing } = useMemo(() => {
    const result: ReorderRow[] = [];
    const missing: Material[] = [];
    let noThreshold = 0;
    (materials || []).forEach((m) => {
      const threshold = Number(m.threshold) || 0;
      if (threshold <= 0) noThreshold += 1;
      const s = stockByMaterial.get(m.id);
      if (!s) {
        if (threshold > 0) missing.push(m);
        return;
      }
      let status: Status | null = null;
      if (s.stock <= 0) status = "out";
      else if (threshold > 0 && s.stock <= threshold) status = "below";
      else if (includeNear && threshold > 0 && s.stock <= threshold * NEAR_FACTOR) status = "near";
      if (!status) return;

      const avgDaily = Math.max(0, s.used) / USAGE_WINDOW_DAYS;
      result.push({
        material: m,
        stock: s.stock,
        lastClosing: s.lastClosing,
        daysSinceClosing: differenceInCalendarDays(asOfDate, parseISO(s.lastClosing)),
        threshold,
        avgDaily,
        daysLeft: avgDaily > 0 ? Math.max(0, s.stock) / avgDaily : null,
        suggested: Math.max(0, Math.ceil(avgDaily * cover + threshold - s.stock)),
        rate: Number(m.cost_value) || 0,
        status,
      });
    });
    result.sort(
      (a, b) =>
        STATUS_META[a.status].rank - STATUS_META[b.status].rank ||
        (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) ||
        a.material.code.localeCompare(b.material.code),
    );
    return { rows: result, noThresholdCount: noThreshold, noClosing: missing };
  }, [materials, stockByMaterial, includeNear, cover, asOfDate]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tierFilter !== "all" && r.material.value_category !== tierFilter) return false;
      if (priorityFilter !== "all" && (r.material.priority || "medium") !== priorityFilter) return false;
      if (q && !r.material.code.toLowerCase().includes(q) && !r.material.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, tierFilter, priorityFilter, search]);

  const orderQty = (r: ReorderRow) => {
    const o = qtyOverrides[r.material.id];
    return o === undefined || o === "" ? r.suggested : Math.max(0, Number(o) || 0);
  };

  const selectedRows = rows.filter((r) => selected.has(r.material.id));
  const selectedValue = selectedRows.reduce((sum, r) => sum + orderQty(r) * r.rate, 0);
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.material.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleAllVisible = (on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      visibleRows.forEach((r) => (on ? next.add(r.material.id) : next.delete(r.material.id)));
      return next;
    });

  const handlePrint = () => {
    const toPrint = selectedRows.filter((r) => orderQty(r) > 0);
    if (toPrint.length === 0) {
      toast.error("Select at least one material with an order quantity above zero");
      return;
    }
    const groups = new Map<string, ReorderRow[]>();
    toPrint.forEach((r) => {
      const key = materialValueCategoryLabel(r.material.value_category);
      groups.set(key, [...(groups.get(key) || []), r]);
    });
    const valueCols = showValue ? `<th class="num">Rate</th><th class="num">Est. Value</th>` : "";
    const colCount = showValue ? 10 : 8;
    let serial = 0;
    let grandTotal = 0;
    const bodyRows = Array.from(groups.entries())
      .map(([tier, list]) => {
        const subtotal = list.reduce((s, r) => s + orderQty(r) * r.rate, 0);
        grandTotal += subtotal;
        const lines = list
          .map((r) => {
            serial += 1;
            const qty = orderQty(r);
            return `<tr>
              <td>${serial}</td>
              <td>${esc(r.material.code)}</td>
              <td>${esc(r.material.name)}</td>
              <td>${esc(r.material.unit || "")}</td>
              <td class="num">${esc(fmtNum(r.stock))}<div class="xs muted">${esc(format(parseISO(r.lastClosing), "dd MMM"))}</div></td>
              <td class="num">${esc(fmtNum(r.threshold))}</td>
              <td class="num">${r.daysLeft === null ? "—" : esc(r.daysLeft.toFixed(1))}</td>
              <td class="num bold">${esc(fmtNum(qty))}</td>
              ${showValue ? `<td class="num">${esc(fmtNum(r.rate))}</td><td class="num">${esc(fmtNum(qty * r.rate))}</td>` : ""}
            </tr>${remarks[r.material.id]?.trim() ? `<tr><td></td><td colspan="${colCount - 1}" class="xs muted">Remarks: ${esc(remarks[r.material.id].trim())}</td></tr>` : ""}`;
          })
          .join("");
        const subtotalRow = showValue
          ? `<tr><td colspan="${colCount - 1}" class="right bold">Subtotal — ${esc(tier)}</td><td class="num bold">${esc(fmtNum(subtotal))}</td></tr>`
          : "";
        return `<tr><td colspan="${colCount}" class="bold" style="background:#f1f1f1">${esc(tier)}</td></tr>${lines}${subtotalRow}`;
      })
      .join("");

    const body = `
      <div class="wrap" style="max-width:none">
        <div class="head">
          <div>
            <h1>Cansport Global Industries</h1>
            <div class="bold" style="margin-top:6px; letter-spacing:.06em">RAW MATERIAL REORDER REQUISITION</div>
          </div>
          <div class="xs muted right">
            <div>Date: <b>${esc(format(new Date(), "dd MMM yyyy"))}</b></div>
            <div>Stock as of: <b>${esc(format(asOfDate, "dd MMM yyyy"))}</b></div>
            <div>Cover days: <b>${cover}</b></div>
            <div>Printed ${esc(format(new Date(), "dd MMM yyyy, HH:mm"))}</div>
          </div>
        </div>
        <table>
          <thead><tr>
            <th>#</th><th>Code</th><th>Material</th><th>Unit</th>
            <th class="num">Stock</th><th class="num">Threshold</th><th class="num">Days Left</th>
            <th class="num">Order Qty</th>${valueCols}
          </tr></thead>
          <tbody>${bodyRows}</tbody>
          ${showValue ? `<tfoot><tr><td colspan="${colCount - 1}" class="right">Total Estimated Value</td><td class="num">${esc(fmtNum(grandTotal))}</td></tr></tfoot>` : ""}
        </table>
        <div class="xs muted" style="margin-top:8px">
          ${toPrint.length} item(s). Suggested qty = avg daily use (last ${USAGE_WINDOW_DAYS} days) × cover days + threshold − stock; adjusted where noted.
        </div>
        <div class="sign"><div>Prepared by</div><div>Store</div><div>Approved by</div></div>
      </div>`;
    printDocument(`Reorder Requisition ${format(asOfDate, "dd-MM-yyyy")}`, body);
  };

  const isLoading = materialsLoading || closingLoading;

  return (
    <ERPLayout>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Reorder Requirement</h1>
            <p className="text-sm text-muted-foreground">
              Raw materials at or below their threshold. Tick the items to reorder and print a requisition.
            </p>
          </div>
          <Button onClick={handlePrint} disabled={selectedRows.length === 0}>
            <Printer className="mr-2 h-4 w-4" />
            Print Requisition ({selectedRows.length})
          </Button>
        </div>

        <Card>
          <CardContent className="grid grid-cols-1 gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-6">
            <div className="space-y-1">
              <Label>Stock as of</Label>
              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(asOfDate, "dd MMM yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={asOfDate}
                    onSelect={(d) => {
                      if (d) setAsOfDate(d);
                      setIsCalendarOpen(false);
                    }}
                    disabled={(d) => d > new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <Label>Cover days</Label>
              <Input type="number" min={0} value={coverDays} onChange={(e) => setCoverDays(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Value tier</Label>
              <Select value={tierFilter} onValueChange={(v) => setTierFilter(v as MaterialValueCategory | "all")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All value tiers</SelectItem>
                  {MATERIAL_VALUE_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Priority</Label>
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All priorities</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Search</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Code or name" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="flex items-end gap-2 pb-2">
              <Switch id="include-near" checked={includeNear} onCheckedChange={setIncludeNear} />
              <Label htmlFor="include-near" className="text-sm">
                Include near threshold (≤ {Math.round(NEAR_FACTOR * 100)}%)
              </Label>
            </div>
          </CardContent>
        </Card>

        {(noThresholdCount > 0 || noClosing.length > 0) && (
          <div className="space-y-2">
            {noThresholdCount > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {noThresholdCount} active material(s) have no threshold set, so they only appear here when stock is zero.{" "}
                  <Link to="/consumption/raw-materials" className="font-medium underline">Set thresholds in Raw Materials</Link>
                </span>
              </div>
            )}
            {noClosing.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  No stock closing in the last {STOCK_LOOKBACK_DAYS} days for {noClosing.length} material(s) with a threshold, so their stock is unknown:{" "}
                  {noClosing.slice(0, 8).map((m) => m.code).join(", ")}
                  {noClosing.length > 8 ? ` and ${noClosing.length - 8} more` : ""}
                </span>
              </div>
            )}
          </div>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              {visibleRows.length} material(s) to review
            </CardTitle>
            <div className="text-sm text-muted-foreground">
              {selectedRows.length} selected{showValue && selectedRows.length > 0 ? ` · Est. ₹${fmtNum(selectedValue)}` : ""}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
            ) : visibleRows.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No materials at or below threshold as of {format(asOfDate, "dd MMM yyyy")}.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allVisibleSelected}
                        onCheckedChange={(v) => toggleAllVisible(v === true)}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead>Last Closing</TableHead>
                    <TableHead className="text-right">Threshold</TableHead>
                    <TableHead className="text-right">Avg Daily Use</TableHead>
                    <TableHead className="text-right">Days Left</TableHead>
                    <TableHead className="text-right">Order Qty</TableHead>
                    {showValue && <TableHead className="text-right">Rate</TableHead>}
                    {showValue && <TableHead className="text-right">Est. Value</TableHead>}
                    <TableHead>Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((r) => {
                    const id = r.material.id;
                    const isSelected = selected.has(id);
                    const stale = r.daysSinceClosing > STALE_DAYS;
                    return (
                      <TableRow key={id} data-state={isSelected ? "selected" : undefined}>
                        <TableCell>
                          <Checkbox checked={isSelected} onCheckedChange={(v) => toggle(id, v === true)} aria-label={`Select ${r.material.code}`} />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{r.material.name}</div>
                          <div className="text-xs text-muted-foreground">{r.material.code} · {r.material.unit || "—"}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{materialValueCategoryCode(r.material.value_category)}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.status === "near" ? "secondary" : "destructive"} className="whitespace-nowrap">
                            {STATUS_META[r.status].label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">{fmtNum(r.stock)}</TableCell>
                        <TableCell className={cn("whitespace-nowrap", stale && "font-medium text-amber-600")}>
                          {format(parseISO(r.lastClosing), "dd MMM yyyy")}
                          {stale && <div className="text-xs">{r.daysSinceClosing} days old</div>}
                        </TableCell>
                        <TableCell className="text-right">{r.threshold > 0 ? fmtNum(r.threshold) : "—"}</TableCell>
                        <TableCell className="text-right">{fmtNum(r.avgDaily)}</TableCell>
                        <TableCell className="text-right">{r.daysLeft === null ? "—" : r.daysLeft.toFixed(1)}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            className="ml-auto h-8 w-24 text-right"
                            value={qtyOverrides[id] ?? String(r.suggested)}
                            onChange={(e) => {
                              setQtyOverrides((prev) => ({ ...prev, [id]: e.target.value }));
                              if (!isSelected) toggle(id, true);
                            }}
                          />
                        </TableCell>
                        {showValue && <TableCell className="text-right">{fmtNum(r.rate)}</TableCell>}
                        {showValue && <TableCell className="text-right">{fmtNum(orderQty(r) * r.rate)}</TableCell>}
                        <TableCell>
                          <Input
                            className="h-8 min-w-32"
                            placeholder="Optional"
                            value={remarks[id] ?? ""}
                            onChange={(e) => setRemarks((prev) => ({ ...prev, [id]: e.target.value }))}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Suggested order qty = average daily use over the last {USAGE_WINDOW_DAYS} days × cover days + threshold − current stock,
          rounded up. Edit any quantity before printing. Closings older than {STALE_DAYS} days are highlighted.
        </p>
      </div>
    </ERPLayout>
  );
}
