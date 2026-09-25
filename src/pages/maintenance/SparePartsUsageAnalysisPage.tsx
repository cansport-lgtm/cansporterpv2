import { Fragment, useState, useEffect, useMemo } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  Search,
  Package,
  IndianRupee,
  Cog,
  Layers,
  Receipt,
  TrendingUp,
  TrendingDown,
  Download,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
  differenceInCalendarDays,
  subDays,
  parseISO,
  eachDayOfInterval,
  eachMonthOfInterval,
} from "date-fns";
import {
  ComposedChart,
  Bar,
  BarChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

// ---------- Types ----------

interface IssueRow {
  id: string;
  issue_number: string;
  issue_date: string;
  quantity_issued: number;
  unit_cost: number | null;
  total_cost: number | null;
  usage_type: string;
  purpose: string | null;
  remarks: string | null;
  status: string | null;
  spare_part_id: string;
  machine_id: string | null;
  spare_parts: { code: string; name: string; category: string | null; unit_of_measure: string | null } | null;
  machines: { code: string; name: string; production_departments: { name: string } | null } | null;
  app_users_issued_to: { full_name: string } | null;
  maintenance_work_orders: { work_order_number: string } | null;
}

interface SparePart {
  id: string;
  code: string;
  name: string;
  category: string | null;
  current_stock: number | null;
  minimum_stock: number | null;
  unit_cost: number | null;
  unit_of_measure: string | null;
}

interface PartUsage {
  id: string;
  code: string;
  name: string;
  category: string;
  uom: string;
  issues: number;
  qty: number;
  cost: number;
  share: number;
  cumShare: number;
  abc: "A" | "B" | "C";
  avgMonthlyQty: number;
  currentStock: number;
  minimumStock: number;
  monthsCover: number | null;
  lastIssued: string;
  machineCount: number;
  machines: { name: string; qty: number; cost: number }[];
}

interface GroupUsage {
  id: string;
  label: string;
  sub?: string;
  issues: number;
  qty: number;
  cost: number;
  share: number;
  distinctParts: number;
  topPart: string;
}

// ---------- Constants / helpers ----------

const USAGE_TYPES = [
  { value: "maintenance", label: "Maintenance" },
  { value: "new_machinery_development", label: "New Development" },
];
const usageTypeLabel = (v: string) => USAGE_TYPES.find((u) => u.value === v)?.label || v;

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
];

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
};

const rs = (n: number, digits = 0) =>
  `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const qtyFmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const pct = (n: number) => `${n.toFixed(1)}%`;
const fmtDate = (d: string) => format(parseISO(d), "dd MMM yyyy");

type Preset = "this_month" | "last_month" | "last_3_months" | "last_6_months" | "last_12_months" | "ytd" | "custom";

const presetRange = (p: Preset): { from: string; to: string } | null => {
  const today = new Date();
  const f = (d: Date) => format(d, "yyyy-MM-dd");
  switch (p) {
    case "this_month":
      return { from: f(startOfMonth(today)), to: f(today) };
    case "last_month": {
      const lm = subMonths(today, 1);
      return { from: f(startOfMonth(lm)), to: f(endOfMonth(lm)) };
    }
    case "last_3_months":
      return { from: f(startOfMonth(subMonths(today, 2))), to: f(today) };
    case "last_6_months":
      return { from: f(startOfMonth(subMonths(today, 5))), to: f(today) };
    case "last_12_months":
      return { from: f(startOfMonth(subMonths(today, 11))), to: f(today) };
    case "ytd":
      return { from: f(startOfYear(today)), to: f(today) };
    default:
      return null;
  }
};

// ---------- Small sortable table ----------

interface Col<T> {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  sortValue?: (row: T) => number | string;
  render: (row: T) => React.ReactNode;
}

function SortableTable<T extends { id: string }>({
  columns,
  rows,
  defaultSort,
  expand,
  empty = "No data for the selected filters",
  footer,
}: {
  columns: Col<T>[];
  rows: T[];
  defaultSort?: { key: string; dir: "asc" | "desc" };
  expand?: (row: T) => React.ReactNode;
  empty?: string;
  footer?: React.ReactNode;
}) {
  const [sort, setSort] = useState(defaultSort);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const alignCls = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {expand && <TableHead className="w-8" />}
            {columns.map((c) => (
              <TableHead key={c.key} className={`${alignCls(c.align)} whitespace-nowrap`}>
                {c.sortValue ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key)}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {c.header}
                    <ArrowUpDown className={`h-3 w-3 ${sort?.key === c.key ? "text-foreground" : "opacity-40"}`} />
                  </button>
                ) : (
                  c.header
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length + (expand ? 1 : 0)} className="text-center py-8 text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((row) => (
              <Fragment key={row.id}>
                <TableRow
                  className={expand ? "cursor-pointer" : undefined}
                  onClick={expand ? () => toggleOpen(row.id) : undefined}
                >
                  {expand && (
                    <TableCell className="w-8 pr-0">
                      {open.has(row.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </TableCell>
                  )}
                  {columns.map((c) => (
                    <TableCell key={c.key} className={`${alignCls(c.align)} whitespace-nowrap`}>
                      {c.render(row)}
                    </TableCell>
                  ))}
                </TableRow>
                {expand && open.has(row.id) && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={columns.length + 1} className="bg-muted/20 p-0">
                      {expand(row)}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))
          )}
          {footer}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------- Page ----------

export default function SparePartsUsageAnalysisPage() {
  const initial = presetRange("last_3_months")!;
  const [preset, setPreset] = useState<Preset>("last_3_months");
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);

  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [prevIssues, setPrevIssues] = useState<IssueRow[]>([]);
  const [parts, setParts] = useState<SparePart[]>([]);
  const [loading, setLoading] = useState(true);

  const [usageType, setUsageType] = useState("all");
  const [category, setCategory] = useState("all");
  const [machineFilter, setMachineFilter] = useState("all");
  const [department, setDepartment] = useState("all");
  const [search, setSearch] = useState("");

  const onPresetChange = (p: Preset) => {
    setPreset(p);
    const r = presetRange(p);
    if (r) {
      setFromDate(r.from);
      setToDate(r.to);
    }
  };

  // Previous period of equal length, used for the comparison KPI.
  const prevRange = useMemo(() => {
    const days = differenceInCalendarDays(parseISO(toDate), parseISO(fromDate)) + 1;
    const prevTo = subDays(parseISO(fromDate), 1);
    const prevFrom = subDays(prevTo, days - 1);
    return { from: format(prevFrom, "yyyy-MM-dd"), to: format(prevTo, "yyyy-MM-dd"), days };
  }, [fromDate, toDate]);

  useEffect(() => {
    if (!fromDate || !toDate || fromDate > toDate) return;
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const select = `
        id, issue_number, issue_date, quantity_issued, unit_cost, total_cost,
        usage_type, purpose, remarks, status, spare_part_id, machine_id,
        spare_parts(code, name, category, unit_of_measure),
        machines(code, name, production_departments(name)),
        app_users_issued_to:app_users!spare_part_issues_issued_to_fkey(full_name),
        maintenance_work_orders(work_order_number)
      `;
      const [rows, partsRes] = await Promise.all([
        fetchAllRows<IssueRow>((from, to) =>
          supabase
            .from("spare_part_issues")
            .select(select)
            .gte("issue_date", prevRange.from)
            .lte("issue_date", toDate)
            .order("issue_date", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        ),
        supabase
          .from("spare_parts")
          .select("id, code, name, category, current_stock, minimum_stock, unit_cost, unit_of_measure")
          .eq("is_active", true)
          .order("name"),
      ]);
      if (partsRes.error) throw partsRes.error;
      setIssues(rows.filter((r) => r.issue_date >= fromDate));
      setPrevIssues(rows.filter((r) => r.issue_date < fromDate));
      setParts(partsRes.data || []);
    } catch (error) {
      console.error("Error fetching usage data:", error);
      toast.error("Failed to load spare parts usage data");
    } finally {
      setLoading(false);
    }
  };

  // ---------- Filter options ----------

  const categories = useMemo(
    () => Array.from(new Set(parts.map((p) => p.category || "Uncategorized"))).sort(),
    [parts],
  );
  const machineOptions = useMemo(() => {
    const m = new Map<string, string>();
    issues.forEach((i) => i.machine_id && i.machines && m.set(i.machine_id, `${i.machines.code} - ${i.machines.name}`));
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [issues]);
  const departments = useMemo(
    () =>
      Array.from(
        new Set(issues.map((i) => i.machines?.production_departments?.name).filter(Boolean) as string[]),
      ).sort(),
    [issues],
  );

  const applyFilters = (rows: IssueRow[]) => {
    const q = search.trim().toLowerCase();
    return rows.filter((i) => {
      if (usageType !== "all" && i.usage_type !== usageType) return false;
      if (category !== "all" && (i.spare_parts?.category || "Uncategorized") !== category) return false;
      if (machineFilter === "none" && i.machine_id) return false;
      if (machineFilter !== "all" && machineFilter !== "none" && i.machine_id !== machineFilter) return false;
      if (department !== "all" && i.machines?.production_departments?.name !== department) return false;
      if (q) {
        const hay = `${i.spare_parts?.code} ${i.spare_parts?.name} ${i.issue_number} ${i.machines?.name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  };

  const filtered = useMemo(
    () => applyFilters(issues),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [issues, usageType, category, machineFilter, department, search],
  );
  const filteredPrev = useMemo(
    () => applyFilters(prevIssues),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prevIssues, usageType, category, machineFilter, department, search],
  );

  // ---------- KPIs ----------

  const kpis = useMemo(() => {
    const cost = filtered.reduce((s, i) => s + (i.total_cost || 0), 0);
    const qty = filtered.reduce((s, i) => s + i.quantity_issued, 0);
    const prevCost = filteredPrev.reduce((s, i) => s + (i.total_cost || 0), 0);
    const distinctParts = new Set(filtered.map((i) => i.spare_part_id)).size;
    const distinctMachines = new Set(filtered.map((i) => i.machine_id).filter(Boolean)).size;
    const maintCost = filtered
      .filter((i) => i.usage_type === "maintenance")
      .reduce((s, i) => s + (i.total_cost || 0), 0);
    return {
      cost,
      qty,
      issues: filtered.length,
      distinctParts,
      distinctMachines,
      avgPerIssue: filtered.length ? cost / filtered.length : 0,
      avgPerDay: prevRange.days ? cost / prevRange.days : 0,
      prevCost,
      change: prevCost > 0 ? ((cost - prevCost) / prevCost) * 100 : null,
      maintShare: cost > 0 ? (maintCost / cost) * 100 : 0,
    };
  }, [filtered, filteredPrev, prevRange.days]);

  // ---------- Trend ----------

  const trend = useMemo(() => {
    const start = parseISO(fromDate);
    const end = parseISO(toDate);
    const daily = prevRange.days <= 62;
    const buckets = daily
      ? eachDayOfInterval({ start, end }).map((d) => ({ key: format(d, "yyyy-MM-dd"), label: format(d, "dd MMM") }))
      : eachMonthOfInterval({ start, end }).map((d) => ({ key: format(d, "yyyy-MM"), label: format(d, "MMM yy") }));
    const map = new Map(buckets.map((b) => [b.key, { label: b.label, cost: 0, qty: 0, issues: 0 }]));
    filtered.forEach((i) => {
      const k = daily ? i.issue_date : i.issue_date.slice(0, 7);
      const b = map.get(k);
      if (b) {
        b.cost += i.total_cost || 0;
        b.qty += i.quantity_issued;
        b.issues += 1;
      }
    });
    return { daily, data: Array.from(map.values()) };
  }, [filtered, fromDate, toDate, prevRange.days]);

  // ---------- Part-wise ----------

  const partUsage: PartUsage[] = useMemo(() => {
    const months = Math.max(prevRange.days / 30.44, 1 / 30.44);
    const partById = new Map(parts.map((p) => [p.id, p]));
    const map = new Map<
      string,
      { issues: number; qty: number; cost: number; last: string; machines: Map<string, { name: string; qty: number; cost: number }>; row: IssueRow }
    >();
    filtered.forEach((i) => {
      let e = map.get(i.spare_part_id);
      if (!e) {
        e = { issues: 0, qty: 0, cost: 0, last: i.issue_date, machines: new Map(), row: i };
        map.set(i.spare_part_id, e);
      }
      e.issues += 1;
      e.qty += i.quantity_issued;
      e.cost += i.total_cost || 0;
      if (i.issue_date > e.last) e.last = i.issue_date;
      const mKey = i.machine_id || "__none__";
      const mName = i.machines ? `${i.machines.code} - ${i.machines.name}` : "No machine (general)";
      const m = e.machines.get(mKey) || { name: mName, qty: 0, cost: 0 };
      m.qty += i.quantity_issued;
      m.cost += i.total_cost || 0;
      e.machines.set(mKey, m);
    });

    const total = Array.from(map.values()).reduce((s, e) => s + e.cost, 0);
    const list = Array.from(map.entries())
      .map(([id, e]) => {
        const p = partById.get(id);
        const avgMonthlyQty = e.qty / months;
        const stock = p?.current_stock ?? 0;
        return {
          id,
          code: p?.code || e.row.spare_parts?.code || "-",
          name: p?.name || e.row.spare_parts?.name || "Unknown",
          category: p?.category || e.row.spare_parts?.category || "Uncategorized",
          uom: p?.unit_of_measure || e.row.spare_parts?.unit_of_measure || "",
          issues: e.issues,
          qty: e.qty,
          cost: e.cost,
          share: total > 0 ? (e.cost / total) * 100 : 0,
          cumShare: 0,
          abc: "C" as const,
          avgMonthlyQty,
          currentStock: stock,
          minimumStock: p?.minimum_stock ?? 0,
          monthsCover: avgMonthlyQty > 0 ? stock / avgMonthlyQty : null,
          lastIssued: e.last,
          machineCount: Array.from(e.machines.keys()).filter((k) => k !== "__none__").length,
          machines: Array.from(e.machines.values()).sort((a, b) => b.cost - a.cost),
        };
      })
      .sort((a, b) => b.cost - a.cost);

    // ABC classification on cumulative cost share (A ≤ 80%, B ≤ 95%, C rest)
    let cum = 0;
    return list.map((p) => {
      const before = cum;
      cum += p.share;
      const abc: "A" | "B" | "C" = before < 80 ? "A" : before < 95 ? "B" : "C";
      return { ...p, cumShare: cum, abc };
    });
  }, [filtered, parts, prevRange.days]);

  const abcSummary = useMemo(() => {
    const s = { A: { count: 0, cost: 0 }, B: { count: 0, cost: 0 }, C: { count: 0, cost: 0 } };
    partUsage.forEach((p) => {
      s[p.abc].count += 1;
      s[p.abc].cost += p.cost;
    });
    return s;
  }, [partUsage]);

  // ---------- Generic grouping ----------

  const groupBy = (keyFn: (i: IssueRow) => { id: string; label: string; sub?: string }): GroupUsage[] => {
    const map = new Map<
      string,
      { label: string; sub?: string; issues: number; qty: number; cost: number; parts: Map<string, { name: string; cost: number }> }
    >();
    filtered.forEach((i) => {
      const k = keyFn(i);
      const e = map.get(k.id) || { label: k.label, sub: k.sub, issues: 0, qty: 0, cost: 0, parts: new Map() };
      e.issues += 1;
      e.qty += i.quantity_issued;
      e.cost += i.total_cost || 0;
      const p = e.parts.get(i.spare_part_id) || { name: i.spare_parts?.name || "-", cost: 0 };
      p.cost += i.total_cost || 0;
      e.parts.set(i.spare_part_id, p);
      map.set(k.id, e);
    });
    const total = kpis.cost;
    return Array.from(map.entries())
      .map(([id, e]) => {
        const top = Array.from(e.parts.values()).sort((a, b) => b.cost - a.cost)[0];
        return {
          id,
          label: e.label,
          sub: e.sub,
          issues: e.issues,
          qty: e.qty,
          cost: e.cost,
          share: total > 0 ? (e.cost / total) * 100 : 0,
          distinctParts: e.parts.size,
          topPart: top?.name || "-",
        };
      })
      .sort((a, b) => b.cost - a.cost);
  };

  const machineUsage = useMemo(
    () =>
      groupBy((i) =>
        i.machines
          ? { id: i.machine_id!, label: `${i.machines.code} - ${i.machines.name}`, sub: i.machines.production_departments?.name || "-" }
          : { id: "__none__", label: "No machine (general)", sub: "-" },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, kpis.cost],
  );
  const categoryUsage = useMemo(
    () => groupBy((i) => ({ id: i.spare_parts?.category || "Uncategorized", label: i.spare_parts?.category || "Uncategorized" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, kpis.cost],
  );
  const departmentUsage = useMemo(
    () =>
      groupBy((i) => {
        const d = i.machines?.production_departments?.name || "Unassigned";
        return { id: d, label: d };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, kpis.cost],
  );
  const personUsage = useMemo(
    () =>
      groupBy((i) => {
        const n = i.app_users_issued_to?.full_name || "Not recorded";
        return { id: n, label: n };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, kpis.cost],
  );
  const usageTypeSplit = useMemo(
    () =>
      groupBy((i) => ({ id: i.usage_type, label: usageTypeLabel(i.usage_type) })).map((g) => ({
        name: g.label,
        value: g.cost,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, kpis.cost],
  );

  // ---------- Non-moving parts (stock on hand, no issue in period) ----------

  const nonMoving = useMemo(() => {
    const used = new Set(issues.map((i) => i.spare_part_id));
    return parts
      .filter((p) => (p.current_stock ?? 0) > 0 && !used.has(p.id))
      .filter((p) => category === "all" || (p.category || "Uncategorized") === category)
      .map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        category: p.category || "Uncategorized",
        stock: p.current_stock ?? 0,
        uom: p.unit_of_measure || "",
        unitCost: p.unit_cost ?? 0,
        value: (p.current_stock ?? 0) * (p.unit_cost ?? 0),
      }))
      .sort((a, b) => b.value - a.value);
  }, [parts, issues, category]);
  const nonMovingValue = nonMoving.reduce((s, p) => s + p.value, 0);

  // ---------- Export ----------

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const add = (name: string, rows: Record<string, unknown>[]) =>
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: "No data" }]), name);

    add("Summary", [
      { Metric: "Period", Value: `${fromDate} to ${toDate}` },
      { Metric: "Total Cost", Value: kpis.cost },
      { Metric: "Total Quantity", Value: kpis.qty },
      { Metric: "Issue Transactions", Value: kpis.issues },
      { Metric: "Distinct Parts", Value: kpis.distinctParts },
      { Metric: "Machines", Value: kpis.distinctMachines },
      { Metric: "Avg Cost / Issue", Value: kpis.avgPerIssue },
      { Metric: "Previous Period Cost", Value: kpis.prevCost },
      { Metric: "Change vs Previous (%)", Value: kpis.change ?? "n/a" },
    ]);
    add(
      "Part-wise",
      partUsage.map((p) => ({
        Code: p.code,
        Name: p.name,
        Category: p.category,
        UOM: p.uom,
        Issues: p.issues,
        Qty: p.qty,
        Cost: p.cost,
        "Share %": +p.share.toFixed(2),
        "Cumulative %": +p.cumShare.toFixed(2),
        ABC: p.abc,
        "Avg Monthly Qty": +p.avgMonthlyQty.toFixed(2),
        "Current Stock": p.currentStock,
        "Min Stock": p.minimumStock,
        "Months of Cover": p.monthsCover == null ? "" : +p.monthsCover.toFixed(1),
        "Last Issued": p.lastIssued,
        Machines: p.machineCount,
      })),
    );
    const groupRows = (g: GroupUsage[], labelHeader: string, subHeader?: string) =>
      g.map((r) => ({
        [labelHeader]: r.label,
        ...(subHeader ? { [subHeader]: r.sub } : {}),
        Issues: r.issues,
        Qty: r.qty,
        Cost: r.cost,
        "Share %": +r.share.toFixed(2),
        "Distinct Parts": r.distinctParts,
        "Top Part": r.topPart,
      }));
    add("Machine-wise", groupRows(machineUsage, "Machine", "Department"));
    add("Category-wise", groupRows(categoryUsage, "Category"));
    add("Department-wise", groupRows(departmentUsage, "Department"));
    add("Issued-to", groupRows(personUsage, "Issued To"));
    add(
      "Transactions",
      filtered.map((i) => ({
        Date: i.issue_date,
        "Issue #": i.issue_number,
        "Part Code": i.spare_parts?.code,
        "Part Name": i.spare_parts?.name,
        Category: i.spare_parts?.category || "Uncategorized",
        Qty: i.quantity_issued,
        "Unit Cost": i.unit_cost ?? "",
        "Total Cost": i.total_cost ?? 0,
        Machine: i.machines ? `${i.machines.code} - ${i.machines.name}` : "",
        Department: i.machines?.production_departments?.name || "",
        "Usage Type": usageTypeLabel(i.usage_type),
        "Work Order": i.maintenance_work_orders?.work_order_number || "",
        "Issued To": i.app_users_issued_to?.full_name || "",
        Purpose: i.purpose || "",
      })),
    );
    add(
      "Non-moving",
      nonMoving.map((p) => ({
        Code: p.code,
        Name: p.name,
        Category: p.category,
        Stock: p.stock,
        UOM: p.uom,
        "Unit Cost": p.unitCost,
        "Stock Value": p.value,
      })),
    );
    XLSX.writeFile(wb, `Spare_Parts_Usage_${fromDate}_to_${toDate}.xlsx`);
  };

  // ---------- Column definitions ----------

  const partCols: Col<PartUsage>[] = [
    { key: "code", header: "Code", sortValue: (r) => r.code, render: (r) => <span className="font-medium">{r.code}</span> },
    { key: "name", header: "Part Name", sortValue: (r) => r.name, render: (r) => r.name },
    { key: "category", header: "Category", sortValue: (r) => r.category, render: (r) => <span className="text-muted-foreground">{r.category}</span> },
    { key: "issues", header: "Issues", align: "center", sortValue: (r) => r.issues, render: (r) => r.issues },
    { key: "qty", header: "Qty", align: "right", sortValue: (r) => r.qty, render: (r) => `${qtyFmt(r.qty)} ${r.uom}` },
    { key: "cost", header: "Cost", align: "right", sortValue: (r) => r.cost, render: (r) => <span className="font-semibold">{rs(r.cost)}</span> },
    { key: "share", header: "Share", align: "right", sortValue: (r) => r.share, render: (r) => pct(r.share) },
    {
      key: "abc",
      header: "ABC",
      align: "center",
      sortValue: (r) => r.abc,
      render: (r) => (
        <Badge variant={r.abc === "A" ? "destructive" : r.abc === "B" ? "default" : "secondary"}>{r.abc}</Badge>
      ),
    },
    { key: "avg", header: "Avg / Month", align: "right", sortValue: (r) => r.avgMonthlyQty, render: (r) => qtyFmt(r.avgMonthlyQty) },
    {
      key: "stock",
      header: "Stock",
      align: "right",
      sortValue: (r) => r.currentStock,
      render: (r) => (
        <span className={r.currentStock <= r.minimumStock ? "text-destructive font-medium" : undefined}>
          {qtyFmt(r.currentStock)}
        </span>
      ),
    },
    {
      key: "cover",
      header: "Months Cover",
      align: "right",
      sortValue: (r) => r.monthsCover ?? Number.MAX_VALUE,
      render: (r) =>
        r.monthsCover == null ? (
          "-"
        ) : (
          <span className={r.monthsCover < 1 ? "text-destructive font-medium" : r.monthsCover < 2 ? "text-amber-600" : undefined}>
            {r.monthsCover.toFixed(1)}
          </span>
        ),
    },
    { key: "last", header: "Last Issued", sortValue: (r) => r.lastIssued, render: (r) => fmtDate(r.lastIssued) },
    { key: "machines", header: "Machines", align: "center", sortValue: (r) => r.machineCount, render: (r) => r.machineCount },
  ];

  const groupCols = (labelHeader: string, subHeader?: string): Col<GroupUsage>[] => [
    { key: "label", header: labelHeader, sortValue: (r) => r.label, render: (r) => <span className="font-medium">{r.label}</span> },
    ...(subHeader
      ? [{ key: "sub", header: subHeader, sortValue: (r: GroupUsage) => r.sub || "", render: (r: GroupUsage) => r.sub }]
      : []),
    { key: "issues", header: "Issues", align: "center", sortValue: (r) => r.issues, render: (r) => r.issues },
    { key: "qty", header: "Qty", align: "right", sortValue: (r) => r.qty, render: (r) => qtyFmt(r.qty) },
    { key: "cost", header: "Cost", align: "right", sortValue: (r) => r.cost, render: (r) => <span className="font-semibold">{rs(r.cost)}</span> },
    {
      key: "share",
      header: "Share",
      align: "right",
      sortValue: (r) => r.share,
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <div className="w-16 h-1.5 rounded bg-muted overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${Math.min(r.share, 100)}%` }} />
          </div>
          {pct(r.share)}
        </div>
      ),
    },
    { key: "parts", header: "Distinct Parts", align: "center", sortValue: (r) => r.distinctParts, render: (r) => r.distinctParts },
    { key: "top", header: "Top Part (by cost)", render: (r) => <span className="text-muted-foreground">{r.topPart}</span> },
  ];

  const txnRows = useMemo(() => [...filtered].reverse(), [filtered]);
  const txnCols: Col<IssueRow>[] = [
    { key: "date", header: "Date", sortValue: (r) => r.issue_date, render: (r) => fmtDate(r.issue_date) },
    { key: "no", header: "Issue #", sortValue: (r) => r.issue_number, render: (r) => <span className="font-medium">{r.issue_number}</span> },
    { key: "part", header: "Part", sortValue: (r) => r.spare_parts?.name || "", render: (r) => `${r.spare_parts?.code ?? ""} - ${r.spare_parts?.name ?? ""}` },
    { key: "qty", header: "Qty", align: "right", sortValue: (r) => r.quantity_issued, render: (r) => qtyFmt(r.quantity_issued) },
    { key: "cost", header: "Cost", align: "right", sortValue: (r) => r.total_cost || 0, render: (r) => rs(r.total_cost || 0, 2) },
    { key: "machine", header: "Machine", sortValue: (r) => r.machines?.name || "", render: (r) => (r.machines ? `${r.machines.code} - ${r.machines.name}` : "-") },
    {
      key: "type",
      header: "Usage",
      sortValue: (r) => r.usage_type,
      render: (r) => (
        <Badge variant={r.usage_type === "maintenance" ? "secondary" : "outline"}>{usageTypeLabel(r.usage_type)}</Badge>
      ),
    },
    { key: "wo", header: "Work Order", render: (r) => r.maintenance_work_orders?.work_order_number || "-" },
    { key: "to", header: "Issued To", sortValue: (r) => r.app_users_issued_to?.full_name || "", render: (r) => r.app_users_issued_to?.full_name || "-" },
    { key: "purpose", header: "Purpose", render: (r) => <span className="text-muted-foreground">{r.purpose || "-"}</span> },
  ];

  type NonMovingRow = (typeof nonMoving)[number];
  const nonMovingCols: Col<NonMovingRow>[] = [
    { key: "code", header: "Code", sortValue: (r) => r.code, render: (r) => <span className="font-medium">{r.code}</span> },
    { key: "name", header: "Part Name", sortValue: (r) => r.name, render: (r) => r.name },
    { key: "category", header: "Category", sortValue: (r) => r.category, render: (r) => r.category },
    { key: "stock", header: "Stock", align: "right", sortValue: (r) => r.stock, render: (r) => `${qtyFmt(r.stock)} ${r.uom}` },
    { key: "unit", header: "Unit Cost", align: "right", sortValue: (r) => r.unitCost, render: (r) => rs(r.unitCost, 2) },
    { key: "value", header: "Stock Value", align: "right", sortValue: (r) => r.value, render: (r) => <span className="font-semibold">{rs(r.value)}</span> },
  ];

  const partExpand = (p: PartUsage) => (
    <div className="p-4">
      <h4 className="font-semibold text-sm mb-2">Machine-wise usage of {p.name}</h4>
      <table className="w-full text-sm max-w-2xl">
        <thead>
          <tr className="border-b">
            <th className="text-left py-1.5 px-2">Machine</th>
            <th className="text-right py-1.5 px-2">Qty</th>
            <th className="text-right py-1.5 px-2">Cost</th>
            <th className="text-right py-1.5 px-2">Share of part</th>
          </tr>
        </thead>
        <tbody>
          {p.machines.map((m) => (
            <tr key={m.name} className="border-b border-muted">
              <td className="py-1.5 px-2">{m.name}</td>
              <td className="py-1.5 px-2 text-right">{qtyFmt(m.qty)}</td>
              <td className="py-1.5 px-2 text-right">{rs(m.cost)}</td>
              <td className="py-1.5 px-2 text-right">{p.cost > 0 ? pct((m.cost / p.cost) * 100) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // ---------- Render ----------

  const kpiCard = (icon: React.ReactNode, tint: string, label: string, value: React.ReactNode, sub?: React.ReactNode) => (
    <Card className="border-border/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${tint}`}>{icon}</div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold truncate">{value}</p>
            {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const topPartsChart = partUsage.slice(0, 10).map((p) => ({ name: p.code, fullName: p.name, cost: p.cost }));

  return (
    <ERPLayout>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <PageHeader
          title="Spare Parts Usage Analysis"
          description="Detailed consumption analysis by part, machine, category, department and person"
        />
        <Button onClick={exportExcel} variant="outline" disabled={loading}>
          <Download className="h-4 w-4 mr-2" />
          Export Excel
        </Button>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Period</Label>
              <Select value={preset} onValueChange={(v) => onPresetChange(v as Preset)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="this_month">This Month</SelectItem>
                  <SelectItem value="last_month">Last Month</SelectItem>
                  <SelectItem value="last_3_months">Last 3 Months</SelectItem>
                  <SelectItem value="last_6_months">Last 6 Months</SelectItem>
                  <SelectItem value="last_12_months">Last 12 Months</SelectItem>
                  <SelectItem value="ytd">Year to Date</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={fromDate}
                max={toDate}
                onChange={(e) => {
                  setPreset("custom");
                  setFromDate(e.target.value);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={toDate}
                min={fromDate}
                onChange={(e) => {
                  setPreset("custom");
                  setToDate(e.target.value);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Usage Type</Label>
              <Select value={usageType} onValueChange={setUsageType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {USAGE_TYPES.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Department</Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Machine</Label>
              <Select value={machineFilter} onValueChange={setMachineFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Machines</SelectItem>
                  <SelectItem value="none">No machine (general)</SelectItem>
                  {machineOptions.map(([id, label]) => (
                    <SelectItem key={id} value={id}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Part, code, issue #"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground">Loading usage analysis...</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            {kpiCard(
              <IndianRupee className="h-5 w-5 text-amber-500" />,
              "bg-amber-500/10",
              "Total Usage Cost",
              rs(kpis.cost),
              kpis.change == null ? (
                "No prior-period data"
              ) : (
                <span className={`inline-flex items-center gap-1 ${kpis.change > 0 ? "text-destructive" : "text-green-600"}`}>
                  {kpis.change > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {pct(Math.abs(kpis.change))} vs prev. period
                </span>
              ),
            )}
            {kpiCard(<Package className="h-5 w-5 text-blue-500" />, "bg-blue-500/10", "Quantity Issued", qtyFmt(kpis.qty))}
            {kpiCard(
              <Receipt className="h-5 w-5 text-purple-500" />,
              "bg-purple-500/10",
              "Issue Transactions",
              kpis.issues,
              `Avg ${rs(kpis.avgPerIssue)} / issue`,
            )}
            {kpiCard(<Layers className="h-5 w-5 text-green-500" />, "bg-green-500/10", "Distinct Parts Used", kpis.distinctParts)}
            {kpiCard(
              <Cog className="h-5 w-5 text-cyan-500" />,
              "bg-cyan-500/10",
              "Machines Served",
              kpis.distinctMachines,
              `${pct(kpis.maintShare)} for maintenance`,
            )}
            {kpiCard(
              <AlertTriangle className="h-5 w-5 text-red-500" />,
              "bg-red-500/10",
              "Non-moving Stock",
              rs(nonMovingValue),
              `${nonMoving.length} parts not issued`,
            )}
          </div>

          {/* Charts row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">{trend.daily ? "Daily" : "Monthly"} Usage Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={trend.data}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="cost" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <YAxis yAxisId="qty" orientation="right" tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(value: number, name: string) => (name === "Cost" ? rs(value) : qtyFmt(value))}
                      />
                      <Legend />
                      <Bar yAxisId="cost" dataKey="cost" name="Cost" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                      <Line yAxisId="qty" type="monotone" dataKey="qty" name="Qty" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Usage Type Split (Cost)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  {usageTypeSplit.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No data</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={usageTypeSplit} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                          {usageTypeSplit.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => rs(v)} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Top 10 Parts by Cost</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topPartsChart} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(v: number) => [rs(v), "Cost"]}
                        labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
                      />
                      <Bar dataKey="cost" fill="hsl(var(--chart-3))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">ABC Classification</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(["A", "B", "C"] as const).map((k) => {
                  const share = kpis.cost > 0 ? (abcSummary[k].cost / kpis.cost) * 100 : 0;
                  return (
                    <div key={k} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={k === "A" ? "destructive" : k === "B" ? "default" : "secondary"}>Class {k}</Badge>
                          <span className="text-sm text-muted-foreground">{abcSummary[k].count} parts</span>
                        </div>
                        <span className="text-sm font-semibold">{rs(abcSummary[k].cost)}</span>
                      </div>
                      <div className="h-1.5 rounded bg-muted overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${share}%` }} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{pct(share)} of usage cost</p>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground">
                  A = parts making up the first 80% of cost, B = next 15%, C = remaining 5%. Focus stock control on A items.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Detail tabs */}
          <Tabs defaultValue="parts">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="parts">Part-wise ({partUsage.length})</TabsTrigger>
              <TabsTrigger value="machines">Machine-wise ({machineUsage.length})</TabsTrigger>
              <TabsTrigger value="categories">Category-wise ({categoryUsage.length})</TabsTrigger>
              <TabsTrigger value="departments">Department-wise ({departmentUsage.length})</TabsTrigger>
              <TabsTrigger value="people">Issued To ({personUsage.length})</TabsTrigger>
              <TabsTrigger value="transactions">Transactions ({filtered.length})</TabsTrigger>
              <TabsTrigger value="nonmoving">Non-moving ({nonMoving.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="parts" className="mt-4">
              <p className="text-xs text-muted-foreground mb-2">
                Click a row to see which machines consumed the part. Months cover = current stock ÷ average monthly
                consumption in the selected period.
              </p>
              <SortableTable columns={partCols} rows={partUsage} defaultSort={{ key: "cost", dir: "desc" }} expand={partExpand} />
            </TabsContent>
            <TabsContent value="machines" className="mt-4">
              <SortableTable columns={groupCols("Machine", "Department")} rows={machineUsage} defaultSort={{ key: "cost", dir: "desc" }} />
            </TabsContent>
            <TabsContent value="categories" className="mt-4">
              <SortableTable columns={groupCols("Category")} rows={categoryUsage} defaultSort={{ key: "cost", dir: "desc" }} />
            </TabsContent>
            <TabsContent value="departments" className="mt-4">
              <SortableTable columns={groupCols("Department")} rows={departmentUsage} defaultSort={{ key: "cost", dir: "desc" }} />
            </TabsContent>
            <TabsContent value="people" className="mt-4">
              <SortableTable columns={groupCols("Issued To")} rows={personUsage} defaultSort={{ key: "cost", dir: "desc" }} />
            </TabsContent>
            <TabsContent value="transactions" className="mt-4">
              <SortableTable columns={txnCols} rows={txnRows} defaultSort={{ key: "date", dir: "desc" }} />
            </TabsContent>
            <TabsContent value="nonmoving" className="mt-4">
              <p className="text-xs text-muted-foreground mb-2">
                Active parts with stock on hand that were not issued at all in the selected period.
              </p>
              <SortableTable
                columns={nonMovingCols}
                rows={nonMoving}
                defaultSort={{ key: "value", dir: "desc" }}
                empty="Every stocked part was issued in this period"
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </ERPLayout>
  );
}
