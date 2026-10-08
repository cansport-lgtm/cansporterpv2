import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { StockCategoryFilter } from "@/components/shared/StockCategoryFilter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClipboardList, Printer, FileSpreadsheet, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { matchesStockCategory, stockCategoryMeta, type StockCategoryFilterValue } from "@/lib/stockCategories";
import { printDocument, esc } from "@/lib/printDocument";
import cansportLogo from "@/assets/cansport-logo.png";

const logoUrl =
  typeof window !== "undefined" ? new URL(cansportLogo, window.location.origin).href : cansportLogo;

const PRIORITY_RANK: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

/** One contribution to an item's requirement — a manual PR line or the stock shortfall. */
interface SourceLine {
  kind: "manual" | "stock";
  ref: string;
  qty: number;
  requiredBy: string | null;
  priority: string | null;
  remarks: string | null;
}

interface RequirementRow {
  itemId: string;
  code: string;
  name: string;
  unit: string;
  departmentId: string;
  departmentName: string;
  stockCategory: string;
  manualQty: number;
  stockQty: number | null;
  threshold: number;
  shortfallQty: number;
  netQty: number;
  requiredBy: string | null;
  priority: string | null;
  sources: SourceLine[];
}

const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function ProductionRequirementPage() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(format(addDays(new Date(), 6), "yyyy-MM-dd"));
  const [deptFilter, setDeptFilter] = useState("all");
  const [stockCategory, setStockCategory] = useState<StockCategoryFilterValue>("all");
  const [includeManual, setIncludeManual] = useState(true);
  const [includeStock, setIncludeStock] = useState(true);
  const [onlyNet, setOnlyNet] = useState(true);
  const [search, setSearch] = useState("");

  const { data: departments = [] } = useQuery({
    queryKey: ["preq-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name, sequence_order")
        .eq("is_active", true)
        .order("sequence_order");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: planningItems = [] } = useQuery({
    queryKey: ["preq-planning-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planning_items")
        .select("id, code, name, unit, department_id, stock_category, threshold_inventory")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  // In Progress manual requirements whose window overlaps the selected range (Draft/Closed excluded).
  const { data: requirements = [], isLoading: reqLoading } = useQuery({
    queryKey: ["preq-requirements", fromDate, toDate],
    enabled: !!fromDate && !!toDate,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_requirements")
        .select("id, requirement_number, window_from, window_to, title, priority, status")
        .eq("status", "In Progress")
        .lte("window_from", toDate)
        .gte("window_to", fromDate);
      if (error) throw error;
      return data || [];
    },
  });

  const reqIds = requirements.map((r) => r.id);
  const { data: reqItems = [], isLoading: reqItemsLoading } = useQuery({
    queryKey: ["preq-requirement-items", reqIds.join(",")],
    enabled: reqIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_requirement_items")
        .select("id, requirement_id, planning_item_id, required_qty, unit, required_by, remarks")
        .in("requirement_id", reqIds);
      if (error) throw error;
      return data || [];
    },
  });

  // Current stock = the most recent Daily Stock Closing on or before today.
  const { data: latestClosingDate, isLoading: dateLoading } = useQuery({
    queryKey: ["preq-latest-closing-date", today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_stock_closing")
        .select("closing_date")
        .lte("closing_date", today)
        .order("closing_date", { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0]?.closing_date as string | undefined) ?? null;
    },
  });

  const { data: closings = [], isLoading: closingLoading } = useQuery({
    queryKey: ["preq-closings", latestClosingDate],
    enabled: !!latestClosingDate,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_stock_closing")
        .select("planning_item_id, closing_quantity")
        .eq("closing_date", latestClosingDate as string);
      if (error) throw error;
      return data || [];
    },
  });

  const isLoading = reqLoading || reqItemsLoading || dateLoading || closingLoading;

  const deptMap = useMemo(
    () => Object.fromEntries(departments.map((d) => [d.id, d])),
    [departments]
  );

  const rows = useMemo<RequirementRow[]>(() => {
    const reqMap = Object.fromEntries(requirements.map((r) => [r.id, r]));
    const stockMap = new Map<string, number>();
    closings.forEach((c) => stockMap.set(c.planning_item_id, Number(c.closing_quantity) || 0));

    const manualByItem = new Map<string, SourceLine[]>();
    if (includeManual) {
      reqItems.forEach((it) => {
        const req = reqMap[it.requirement_id];
        if (!req || !it.planning_item_id) return;
        // A line with its own required-by date only counts when that date is in range.
        if (it.required_by && (it.required_by < fromDate || it.required_by > toDate)) return;
        const list = manualByItem.get(it.planning_item_id) || [];
        list.push({
          kind: "manual",
          ref: req.requirement_number || "PR",
          qty: Number(it.required_qty) || 0,
          requiredBy: it.required_by || req.window_to,
          priority: req.priority || "Medium",
          remarks: it.remarks || req.title || null,
        });
        manualByItem.set(it.planning_item_id, list);
      });
    }

    const out: RequirementRow[] = [];
    planningItems.forEach((p) => {
      const manual = manualByItem.get(p.id) || [];
      const manualQty = manual.reduce((s, l) => s + l.qty, 0);
      const threshold = Number(p.threshold_inventory) || 0;
      const hasStock = stockMap.has(p.id);
      const stockQty = hasStock ? (stockMap.get(p.id) as number) : null;
      // Stock shortfall only counts for items that have a closing record and a minimum set.
      const shortfallQty =
        includeStock && hasStock && threshold > 0 ? Math.max(0, threshold - (stockQty as number)) : 0;

      if (manualQty <= 0 && shortfallQty <= 0) return;

      const minStock = includeStock && hasStock ? threshold : 0;
      const netQty = Math.max(0, manualQty + minStock - (stockQty ?? 0));

      const sources = [...manual];
      if (shortfallQty > 0) {
        sources.push({
          kind: "stock",
          ref: "Below minimum stock",
          qty: shortfallQty,
          requiredBy: null,
          priority: null,
          remarks: `Stock ${fmt(stockQty ?? 0)} vs minimum ${fmt(threshold)}`,
        });
      }

      const requiredBy = manual
        .map((l) => l.requiredBy)
        .filter(Boolean)
        .sort()[0] as string | undefined;
      const priority = manual
        .map((l) => l.priority as string)
        .sort((a, b) => (PRIORITY_RANK[a] ?? 99) - (PRIORITY_RANK[b] ?? 99))[0];

      out.push({
        itemId: p.id,
        code: p.code,
        name: p.name,
        unit: p.unit || reqItems.find((it) => it.planning_item_id === p.id)?.unit || "pcs",
        departmentId: p.department_id,
        departmentName: deptMap[p.department_id]?.name || "—",
        stockCategory: p.stock_category,
        manualQty,
        stockQty,
        threshold,
        shortfallQty,
        netQty,
        requiredBy: requiredBy ?? null,
        priority: priority ?? null,
        sources,
      });
    });
    return out;
  }, [planningItems, requirements, reqItems, closings, includeManual, includeStock, fromDate, toDate, deptMap]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => deptFilter === "all" || r.departmentId === deptFilter)
      .filter((r) => matchesStockCategory(r.stockCategory, stockCategory))
      .filter((r) => !onlyNet || r.netQty > 0)
      .filter((r) => !q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const da = deptMap[a.departmentId]?.sequence_order ?? 999;
        const db = deptMap[b.departmentId]?.sequence_order ?? 999;
        if (da !== db) return da - db;
        const pa = PRIORITY_RANK[a.priority ?? ""] ?? 99;
        const pb = PRIORITY_RANK[b.priority ?? ""] ?? 99;
        if (pa !== pb) return pa - pb;
        return a.code.localeCompare(b.code);
      });
  }, [rows, deptFilter, stockCategory, onlyNet, search, deptMap]);

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; rows: RequirementRow[] }>();
    filteredRows.forEach((r) => {
      const g = m.get(r.departmentId) || { name: r.departmentName, rows: [] };
      g.rows.push(r);
      m.set(r.departmentId, g);
    });
    return Array.from(m.values());
  }, [filteredRows]);

  const kpis = useMemo(
    () => ({
      items: filteredRows.length,
      manual: filteredRows.reduce((s, r) => s + r.manualQty, 0),
      shortfall: filteredRows.reduce((s, r) => s + r.shortfallQty, 0),
      net: filteredRows.reduce((s, r) => s + r.netQty, 0),
      urgent: filteredRows.filter((r) => r.priority === "Urgent" || r.priority === "High").length,
    }),
    [filteredRows]
  );

  const filtersLabel = () => {
    const parts = [
      `Department: ${deptFilter === "all" ? "All" : deptMap[deptFilter]?.name || "—"}`,
      `Stock category: ${stockCategory === "all" ? "All" : stockCategoryMeta(stockCategory).label}`,
      `Sources: ${[includeManual && "Manual requirements (In Progress)", includeStock && "Stock below minimum"].filter(Boolean).join(" + ") || "None"}`,
    ];
    if (onlyNet) parts.push("Only items with net > 0");
    if (search.trim()) parts.push(`Search: "${search.trim()}"`);
    return parts.join(" · ");
  };

  const handlePrint = (detailed: boolean) => {
    const printedAt = format(new Date(), "dd MMM yyyy HH:mm");
    const head = `<tr><th>#</th><th>Code</th><th>Item</th><th>Unit</th><th>Category</th>
      <th class="num">Manual Req.</th><th class="num">Current Stock</th><th class="num">Min. Stock</th>
      <th class="num">Net to Produce</th><th>Required By</th><th>Priority</th></tr>`;

    const deptSections = groups
      .map((g) => {
        let i = 0;
        const body = g.rows
          .map((r) => {
            i += 1;
            const main = `<tr class="item">
              <td>${i}</td><td>${esc(r.code)}</td><td class="bold">${esc(r.name)}</td><td>${esc(r.unit)}</td>
              <td>${esc(stockCategoryMeta(r.stockCategory).shortLabel)}</td>
              <td class="num">${fmt(r.manualQty)}</td>
              <td class="num">${r.stockQty === null ? "—" : fmt(r.stockQty)}</td>
              <td class="num">${fmt(r.threshold)}</td>
              <td class="num bold">${fmt(r.netQty)}</td>
              <td>${esc(r.requiredBy || "—")}</td><td>${esc(r.priority || "—")}</td></tr>`;
            if (!detailed) return main;
            const src = r.sources
              .map(
                (s) => `<tr class="src"><td></td><td colspan="4">↳ ${esc(s.ref)}${s.remarks ? ` <span class="muted">— ${esc(s.remarks)}</span>` : ""}</td>
                  <td class="num">${fmt(s.qty)}</td><td colspan="3"></td>
                  <td>${esc(s.requiredBy || "")}</td><td>${esc(s.priority || "")}</td></tr>`
              )
              .join("");
            return main + src;
          })
          .join("");
        const deptManual = g.rows.reduce((s, r) => s + r.manualQty, 0);
        const deptNet = g.rows.reduce((s, r) => s + r.netQty, 0);
        return `<div class="section-title">${esc(g.name)} — ${g.rows.length} item${g.rows.length === 1 ? "" : "s"}</div>
          <table><thead>${head}</thead><tbody>${body}</tbody>
          <tfoot><tr><td colspan="5" class="num">Subtotal</td><td class="num">${fmt(deptManual)}</td>
          <td colspan="2"></td><td class="num">${fmt(deptNet)}</td><td colspan="2"></td></tr></tfoot></table>`;
      })
      .join("");

    const body = `
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        body { padding: 0; }
        .wrap { max-width: none; }
        table { page-break-inside: auto; }
        tr { page-break-inside: avoid; }
        tr.src td { font-size: 10px; border-bottom: 1px dotted #ddd; padding-top: 2px; padding-bottom: 2px; }
        .filters { font-size: 10px; color: #444; margin-bottom: 8px; }
        .totals { display: flex; gap: 24px; margin: 8px 0 4px; font-size: 11px; }
      </style>
      <div class="wrap">
        <div class="head">
          <div class="brand">
            <img src="${esc(logoUrl)}" alt="Cansport" />
            <div><h1>PRODUCTION REQUIREMENT</h1>
            <div class="xs muted">${detailed ? "Detailed — with source breakdown" : "Summary"}</div></div>
          </div>
          <div class="right">
            <div class="bold">${esc(fromDate)} → ${esc(toDate)}</div>
            <div>Stock as of: ${esc(latestClosingDate || "No closing data")}</div>
            <div>Printed: ${esc(printedAt)}</div>
          </div>
        </div>
        <div class="filters">${esc(filtersLabel())}</div>
        <div class="totals">
          <div><span class="label">Items</span> <b>${kpis.items}</b></div>
          <div><span class="label">Manual Req.</span> <b>${fmt(kpis.manual)}</b></div>
          <div><span class="label">Stock Shortfall</span> <b>${fmt(kpis.shortfall)}</b></div>
          <div><span class="label">Net to Produce</span> <b>${fmt(kpis.net)}</b></div>
        </div>
        ${groups.length === 0 ? `<div class="muted">No current production requirement for the selected filters.</div>` : deptSections}
        <div class="sign"><div>Prepared By</div><div>Production Manager</div><div>Approved By</div></div>
      </div>`;

    printDocument(`Production Requirement ${fromDate} to ${toDate}`, body);
  };

  const handleExcel = () => {
    const summary = filteredRows.map((r, i) => ({
      "#": i + 1,
      Department: r.departmentName,
      Code: r.code,
      Item: r.name,
      Unit: r.unit,
      "Stock Category": stockCategoryMeta(r.stockCategory).label,
      "Manual Requirement": r.manualQty,
      "Current Stock": r.stockQty ?? "",
      "Minimum Stock": r.threshold,
      "Stock Shortfall": r.shortfallQty,
      "Net to Produce": r.netQty,
      "Required By": r.requiredBy || "",
      Priority: r.priority || "",
      Sources: r.sources.map((s) => s.ref).join(", "),
    }));
    const detail = filteredRows.flatMap((r) =>
      r.sources.map((s) => ({
        Department: r.departmentName,
        Code: r.code,
        Item: r.name,
        Unit: r.unit,
        Source: s.kind === "manual" ? "Manual requirement" : "Stock below minimum",
        Reference: s.ref,
        Qty: s.qty,
        "Required By": s.requiredBy || "",
        Priority: s.priority || "",
        Remarks: s.remarks || "",
      }))
    );
    const info = [
      { Field: "Report", Value: "Production Requirement" },
      { Field: "Date range", Value: `${fromDate} to ${toDate}` },
      { Field: "Stock as of", Value: latestClosingDate || "No closing data" },
      { Field: "Filters", Value: filtersLabel() },
      { Field: "Generated", Value: format(new Date(), "yyyy-MM-dd HH:mm") },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "Detail");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(info), "Info");
    XLSX.writeFile(wb, `Production_Requirement_${fromDate}_to_${toDate}.xlsx`);
  };

  const priorityClass = (p: string | null) =>
    cn(
      "text-xs",
      p === "Urgent" && "bg-red-50 border-red-200 text-red-700",
      p === "High" && "bg-amber-50 border-amber-200 text-amber-700",
      p === "Medium" && "bg-blue-50 border-blue-200 text-blue-700",
      p === "Low" && "bg-slate-50 border-slate-200 text-slate-600"
    );

  const rangeInvalid = !fromDate || !toDate || toDate < fromDate;

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Production Requirement"
          description="Current requirement from In Progress manual requirements and items below minimum stock"
          icon={ClipboardList}
          iconColor="bg-amber-500/10 text-amber-600"
        >
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => handlePrint(false)} disabled={isLoading || rangeInvalid}>
              <Printer className="h-4 w-4 mr-2" /> Print Summary
            </Button>
            <Button variant="outline" onClick={() => handlePrint(true)} disabled={isLoading || rangeInvalid}>
              <Printer className="h-4 w-4 mr-2" /> Print Detailed
            </Button>
            <Button variant="outline" onClick={handleExcel} disabled={isLoading || filteredRows.length === 0}>
              <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Excel
            </Button>
          </div>
        </PageHeader>

        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <Label>From</Label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div>
                <Label>To</Label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
              <div>
                <Label>Department</Label>
                <Select value={deptFilter} onValueChange={setDeptFilter}>
                  <SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Stock Category</Label>
                <StockCategoryFilter value={stockCategory} onChange={setStockCategory} className="w-full" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-4">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Search item code / name" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={includeManual} onCheckedChange={setIncludeManual} /> Manual requirements
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={includeStock} onCheckedChange={setIncludeStock} /> Stock below minimum
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={onlyNet} onCheckedChange={setOnlyNet} /> Only net &gt; 0
              </label>
            </div>
            {rangeInvalid && <p className="text-sm text-destructive mt-2">"To" date must be on or after "From" date.</p>}
            <p className="text-xs text-muted-foreground mt-3">
              Net to Produce = Manual Requirement + Minimum Stock − Current Stock (never below 0). Current stock is from Daily
              Stock Closing of <b>{latestClosingDate || "—"}</b>. Only <b>In Progress</b> requirements whose window overlaps the
              range are included.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Items", value: kpis.items },
            { label: "Manual Requirement", value: fmt(kpis.manual) },
            { label: "Stock Shortfall", value: fmt(kpis.shortfall) },
            { label: "Net to Produce", value: fmt(kpis.net) },
            { label: "Urgent / High", value: kpis.urgent },
          ].map((k) => (
            <Card key={k.label}>
              <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground">{k.label}</CardTitle></CardHeader>
              <CardContent><div className="text-xl font-bold">{k.value}</div></CardContent>
            </Card>
          ))}
        </div>

        {isLoading ? (
          <div className="text-center text-muted-foreground py-10">Loading…</div>
        ) : groups.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-muted-foreground">No current production requirement for the selected filters.</CardContent></Card>
        ) : (
          groups.map((g) => (
            <Card key={g.name}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>{g.name}</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {g.rows.length} item{g.rows.length === 1 ? "" : "s"} · Net {fmt(g.rows.reduce((s, r) => s + r.netQty, 0))}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Code</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Manual Req.</TableHead>
                        <TableHead className="text-right">Current Stock</TableHead>
                        <TableHead className="text-right">Min. Stock</TableHead>
                        <TableHead className="text-right">Net to Produce</TableHead>
                        <TableHead>Required By</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Sources</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.rows.map((r) => {
                        const meta = stockCategoryMeta(r.stockCategory);
                        const below = r.stockQty !== null && r.threshold > 0 && r.stockQty < r.threshold;
                        return (
                          <TableRow key={r.itemId}>
                            <TableCell className="font-mono text-xs">{r.code}</TableCell>
                            <TableCell className="font-medium">{r.name}</TableCell>
                            <TableCell className="text-muted-foreground">{r.unit}</TableCell>
                            <TableCell><Badge variant="outline" className={cn("text-xs", meta.badgeClass)}>{meta.shortLabel}</Badge></TableCell>
                            <TableCell className="text-right">{fmt(r.manualQty)}</TableCell>
                            <TableCell className={cn("text-right", below && "text-destructive font-semibold")}>
                              {r.stockQty === null ? "—" : fmt(r.stockQty)}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">{fmt(r.threshold)}</TableCell>
                            <TableCell className="text-right font-bold">{fmt(r.netQty)}</TableCell>
                            <TableCell className="text-xs">{r.requiredBy || "—"}</TableCell>
                            <TableCell>
                              {r.priority ? <Badge variant="outline" className={priorityClass(r.priority)}>{r.priority}</Badge> : "—"}
                            </TableCell>
                            <TableCell className="text-xs max-w-xs">
                              {r.sources.map((s, i) => (
                                <div key={i} className={cn(s.kind === "stock" && "text-destructive")}>
                                  {s.ref}: {fmt(s.qty)}
                                </div>
                              ))}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </ERPLayout>
  );
}
