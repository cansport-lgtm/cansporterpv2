import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, differenceInCalendarDays, parseISO } from "date-fns";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Package, FlaskConical, Banknote, Boxes, AlertTriangle, ChevronRight, ChevronDown,
  Download, Search, Scale, Layers,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  fetchFGMasters, fetchRMMasters, fetchClosingWindow, fetchInventorySnapshot,
  fetchInventoryGLBalance, latestPerItem,
  type ClosingSnapshotRow,
} from "@/lib/accounting/inventoryValuation";

const fmtRs = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;
const fmtRsShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${Math.round(n)}`;
};

const WIP_COLOR = "#f59e0b";
const STALE_AFTER_DAYS = 3;
// Trend needs 14 days plus carry-in; the same window doubles as the
// latest-per-item source when the snapshot RPC is not deployed yet.
const WINDOW_DAYS = 60;

interface ValRow {
  id: string;
  code: string;
  name: string;
  unit: string;
  groupKey: string;
  groupName: string;
  isWip: boolean;
  closingDate: string;
  qty: number;
  rate: number;
  value: number;
  below: boolean;
  unpriced: boolean;
  staleDays: number;
}

interface Group {
  key: string;
  name: string;
  isWip: boolean;
  rows: ValRow[];
  qty: number;
  value: number;
}

function StatusBadges({ r }: { r: ValRow }) {
  const badges = [];
  if (r.below)
    badges.push(<Badge key="low" variant="outline" className="text-[9px] text-red-600 border-red-300">below threshold</Badge>);
  if (r.unpriced)
    badges.push(<Badge key="unpriced" variant="outline" className="text-[9px] text-amber-600 border-amber-300">no cost set</Badge>);
  if (r.staleDays > STALE_AFTER_DAYS)
    badges.push(<Badge key="stale" variant="outline" className="text-[9px] text-muted-foreground">{r.staleDays}d old</Badge>);
  if (!badges.length)
    badges.push(<Badge key="ok" variant="outline" className="text-[9px] text-green-600 border-green-300">OK</Badge>);
  return <div className="flex flex-wrap gap-1">{badges}</div>;
}

export function InventoryValuationDashboard({ variant }: { variant: "fg" | "rm" }) {
  const isFG = variant === "fg";
  const [asOf, setAsOf] = useState(format(new Date(), "yyyy-MM-dd"));
  const [search, setSearch] = useState("");
  const [includeWip, setIncludeWip] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const windowFrom = format(subDays(parseISO(asOf), WINDOW_DAYS - 1), "yyyy-MM-dd");

  const { data: fgMasters } = useQuery({
    queryKey: ["acc-inv-fg-masters"],
    queryFn: fetchFGMasters,
    enabled: isFG,
  });
  const { data: rmMasters } = useQuery({
    queryKey: ["acc-inv-rm-masters"],
    queryFn: fetchRMMasters,
    enabled: !isFG,
  });
  const { data: snapshot, isLoading: snapLoading } = useQuery({
    queryKey: ["acc-inv-snapshot", asOf],
    queryFn: () => fetchInventorySnapshot(asOf),
  });
  const { data: windowRows, isLoading: windowLoading } = useQuery({
    queryKey: ["acc-inv-window", variant, windowFrom, asOf],
    queryFn: () => fetchClosingWindow(variant, windowFrom, asOf),
  });
  const { data: gl } = useQuery({
    queryKey: ["acc-inv-gl", variant, asOf],
    queryFn: () => fetchInventoryGLBalance(
      isFG ? ["finished_goods_inventory", "wip_inventory"] : ["raw_material_inventory"],
      asOf,
    ),
  });

  const mastersLoading = isFG ? !fgMasters : !rmMasters;
  const isLoading = snapLoading || windowLoading || mastersLoading;
  // Snapshot RPC missing (migration not applied yet) → fall back to the window.
  const usingFallback = !snapLoading && snapshot === null;

  const computed = useMemo(() => {
    if (isLoading || !windowRows) return null;

    const latest: ClosingSnapshotRow[] = snapshot
      ? (isFG ? snapshot.fg : snapshot.rm)
      : latestPerItem(windowRows);

    const rows: ValRow[] = [];
    let intermediatesExcluded = 0;

    if (isFG && fgMasters) {
      const deptById = new Map(fgMasters.departments.map((d) => [d.id, d]));
      const itemById = new Map(fgMasters.items.map((i) => [i.id, i]));
      const isPacking = (deptId: string) => {
        const d = deptById.get(deptId);
        return !!d && (d.code === "PACKING" || /pack/i.test(d.name));
      };
      latest.forEach((s) => {
        const item = itemById.get(s.item_id);
        if (!item) return;
        const threshold = Number(item.threshold_inventory) || 0;
        const below = threshold > 0 && s.qty < threshold && (item.is_active ?? true);
        if (s.qty === 0 && !below) return;
        const rate = Number(item.costing_value) || 0;
        const dept = deptById.get(item.department_id);
        rows.push({
          id: item.id, code: item.code, name: item.name, unit: item.unit || "",
          groupKey: item.department_id, groupName: dept?.name || "Unassigned",
          isWip: !isPacking(item.department_id),
          closingDate: s.closing_date, qty: s.qty, rate, value: s.qty * rate,
          below, unpriced: rate === 0 && s.qty !== 0,
          staleDays: differenceInCalendarDays(parseISO(asOf), parseISO(s.closing_date)),
        });
      });
    } else if (!isFG && rmMasters) {
      const itemById = new Map(rmMasters.map((i) => [i.id, i]));
      latest.forEach((s) => {
        const item = itemById.get(s.item_id);
        if (!item) return;
        if (item.source_product_id) {
          // Intermediate material — its value already sits inside WIP.
          if (s.qty !== 0) intermediatesExcluded += 1;
          return;
        }
        const threshold = Number(item.threshold) || 0;
        const below = threshold > 0 && s.qty < threshold && (item.is_active ?? true);
        if (s.qty === 0 && !below) return;
        const rate = Number(item.cost_value) || 0;
        rows.push({
          id: item.id, code: item.code, name: item.name, unit: item.unit || "",
          groupKey: item.category || "Uncategorized", groupName: item.category || "Uncategorized",
          isWip: false,
          closingDate: s.closing_date, qty: s.qty, rate, value: s.qty * rate,
          below, unpriced: rate === 0 && s.qty !== 0,
          staleDays: differenceInCalendarDays(parseISO(asOf), parseISO(s.closing_date)),
        });
      });
    }

    // Grouping
    const groupMap = new Map<string, Group>();
    rows.forEach((r) => {
      let g = groupMap.get(r.groupKey);
      if (!g) {
        g = { key: r.groupKey, name: r.groupName, isWip: r.isWip, rows: [], qty: 0, value: 0 };
        groupMap.set(r.groupKey, g);
      }
      g.rows.push(r);
      g.qty += r.qty;
      g.value += r.value;
    });
    const groups = Array.from(groupMap.values());
    groups.forEach((g) => g.rows.sort((a, b) => a.name.localeCompare(b.name)));
    if (isFG && fgMasters) {
      const seqById = new Map(fgMasters.departments.map((d) => [d.id, d.sequence_order ?? 0]));
      // Finished goods (Packing) first, then WIP from the end of the line backwards.
      groups.sort((a, b) => {
        if (a.isWip !== b.isWip) return a.isWip ? 1 : -1;
        return (seqById.get(b.key) ?? 0) - (seqById.get(a.key) ?? 0);
      });
    } else {
      groups.sort((a, b) => b.value - a.value);
    }

    // Trend: total value per day for the last 14 days (carry-forward within window)
    const days: string[] = [];
    for (let i = 13; i >= 0; i--) days.push(format(subDays(parseISO(asOf), i), "yyyy-MM-dd"));
    const byItem = new Map<string, { date: string; qty: number }[]>();
    windowRows.forEach((r) => {
      let arr = byItem.get(r.item_id);
      if (!arr) { arr = []; byItem.set(r.item_id, arr); }
      arr.push({ date: r.closing_date, qty: r.qty });
    });
    const trendTotals = days.map((d) => ({ date: d, main: 0, wip: 0 }));
    const fgItemById = isFG && fgMasters ? new Map(fgMasters.items.map((i) => [i.id, i])) : null;
    const fgDeptById = isFG && fgMasters ? new Map(fgMasters.departments.map((d) => [d.id, d])) : null;
    const rmItemById = !isFG && rmMasters ? new Map(rmMasters.map((i) => [i.id, i])) : null;
    byItem.forEach((arr, itemId) => {
      let rate = 0;
      let isWip = false;
      if (fgItemById && fgDeptById) {
        const item = fgItemById.get(itemId);
        if (!item) return;
        rate = Number(item.costing_value) || 0;
        const dept = fgDeptById.get(item.department_id);
        isWip = !(dept && (dept.code === "PACKING" || /pack/i.test(dept.name)));
      } else if (rmItemById) {
        const item = rmItemById.get(itemId);
        if (!item || item.source_product_id) return;
        rate = Number(item.cost_value) || 0;
      } else return;
      if (rate === 0) return;
      arr.sort((a, b) => a.date.localeCompare(b.date));
      let ptr = -1;
      days.forEach((d, di) => {
        while (ptr + 1 < arr.length && arr[ptr + 1].date <= d) ptr++;
        if (ptr < 0) return;
        const v = arr[ptr].qty * rate;
        if (isWip) trendTotals[di].wip += v;
        else trendTotals[di].main += v;
      });
    });
    const trend = trendTotals.map((t) => ({
      label: format(parseISO(t.date), "dd MMM"),
      main: Math.round(t.main),
      wip: Math.round(t.wip),
    }));

    const fgOnly = groups.filter((g) => !g.isWip);
    const headline = {
      value: fgOnly.reduce((s, g) => s + g.value, 0),
      qty: fgOnly.reduce((s, g) => s + g.qty, 0),
      items: fgOnly.reduce((s, g) => s + g.rows.filter((r) => r.qty !== 0).length, 0),
      below: fgOnly.reduce((s, g) => s + g.rows.filter((r) => r.below).length, 0),
      unpriced: fgOnly.reduce((s, g) => s + g.rows.filter((r) => r.unpriced).length, 0),
      stale: fgOnly.reduce((s, g) => s + g.rows.filter((r) => r.staleDays > STALE_AFTER_DAYS).length, 0),
    };
    const allTotal = groups.reduce((s, g) => s + g.value, 0);

    return { rows, groups, trend, headline, allTotal, intermediatesExcluded };
  }, [isLoading, windowRows, snapshot, fgMasters, rmMasters, isFG, asOf]);

  const scopeGroups = useMemo(() => {
    if (!computed) return [];
    return isFG && !includeWip ? computed.groups.filter((g) => !g.isWip) : computed.groups;
  }, [computed, isFG, includeWip]);

  const scopeTotal = scopeGroups.reduce((s, g) => s + g.value, 0);
  const scopeQty = scopeGroups.reduce((s, g) => s + g.qty, 0);

  const kpi = useMemo(() => {
    if (!computed) return null;
    if (isFG) return computed.headline;
    const rows = computed.rows;
    return {
      value: computed.allTotal,
      qty: scopeQty,
      items: rows.filter((r) => r.qty !== 0).length,
      below: rows.filter((r) => r.below).length,
      unpriced: rows.filter((r) => r.unpriced).length,
      stale: rows.filter((r) => r.staleDays > STALE_AFTER_DAYS).length,
    };
  }, [computed, isFG, scopeQty]);

  const glComputed = computed?.allTotal ?? 0;
  const glVariance = gl ? glComputed - gl.balance : 0;

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const q = search.trim().toLowerCase();
  const matches = (r: ValRow) => !q || `${r.code} ${r.name}`.toLowerCase().includes(q);

  const exportCsv = () => {
    const head = ["Code", isFG ? "Item" : "Material", "Unit", isFG ? "Department" : "Category", "Closing Date", "Qty", "Rate (Rs.)", "Value (Rs.)", "Status"];
    const lines = [head.join(",")];
    scopeGroups.forEach((g) => g.rows.filter(matches).forEach((r) => {
      const status = [r.below && "below threshold", r.unpriced && "no cost set", r.staleDays > STALE_AFTER_DAYS && `${r.staleDays}d old`].filter(Boolean).join("; ") || "OK";
      lines.push([r.code, `"${r.name.replace(/"/g, '""')}"`, r.unit, `"${g.name.replace(/"/g, '""')}"`, r.closingDate, r.qty, r.rate, Math.round(r.value), `"${status}"`].join(","));
    }));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${isFG ? "fg" : "rm"}-inventory-${asOf}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const title = isFG ? "Finished Goods Inventory" : "Raw Material Inventory";
  const groupLabel = isFG ? "department" : "category";

  return (
    <>
      <PageHeader
        title={title}
        description={isFG
          ? "Current finished-goods stock with valuation — latest daily stock closing × item costing value"
          : "Current raw-material stock with valuation — latest consumption closing × material cost value (intermediates excluded, already valued in WIP)"}
        icon={isFG ? Package : FlaskConical}
      >
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!computed}>
          <Download className="h-4 w-4 mr-1" />Export CSV
        </Button>
      </PageHeader>

      <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 ${isFG ? "lg:grid-cols-3 xl:grid-cols-5" : "lg:grid-cols-4"}`}>
        <MetricCard
          title={isFG ? "Finished Goods Value" : "Raw Material Value"}
          value={kpi ? fmtRs(kpi.value) : "—"}
          icon={Banknote}
          description={isFG ? `Packing dept · as of ${asOf}` : `as of ${asOf} · intermediates excluded`}
        />
        {isFG && (
          <MetricCard
            title="FG + WIP Value"
            value={computed ? fmtRs(computed.allTotal) : "—"}
            icon={Layers}
            description="all departments · matches GL strip"
          />
        )}
        <MetricCard
          title={isFG ? "Quantity On Hand" : "Active Materials"}
          value={kpi ? (isFG ? kpi.qty.toLocaleString() : kpi.items.toLocaleString()) : "—"}
          icon={Boxes}
          description={kpi ? (isFG ? `${kpi.items} items with stock` : `across ${computed?.groups.length ?? 0} categories`) : undefined}
        />
        <MetricCard
          title="Below Threshold"
          value={kpi ? kpi.below : "—"}
          icon={AlertTriangle}
          iconColor={kpi && kpi.below > 0 ? "text-red-500" : undefined}
          description={isFG ? "items under threshold_inventory" : "materials under reorder threshold"}
        />
        <MetricCard
          title="No Cost Set"
          value={kpi ? kpi.unpriced : "—"}
          icon={Scale}
          iconColor={kpi && kpi.unpriced > 0 ? "text-amber-500" : undefined}
          description="excluded from value totals"
        />
      </div>

      <Card className="mb-4">
        <CardContent className="p-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="font-semibold text-muted-foreground">GL reconciliation</span>
          <span className="text-muted-foreground">
            Computed {isFG ? "FG + WIP" : "RM"} value <strong className="text-foreground">{computed ? fmtRs(glComputed) : "—"}</strong>
          </span>
          {gl ? (
            <>
              <span className="text-muted-foreground">
                {gl.accountCode} · {gl.accountName} <strong className="text-foreground">{fmtRs(gl.balance)}</strong>
              </span>
              {computed && (Math.abs(glVariance) < 1 ? (
                <Badge variant="outline" className="text-green-600 border-green-300">✓ Matched</Badge>
              ) : (
                <Badge variant="outline" className="text-amber-600 border-amber-300">
                  Variance {glVariance > 0 ? "+" : "−"}{Math.abs(Math.round(glVariance)).toLocaleString()} — post via Periodic COGS
                </Badge>
              ))}
            </>
          ) : (
            <span className="text-xs text-muted-foreground">No default inventory account mapped (see Default Accounts)</span>
          )}
          {kpi && kpi.stale > 0 && (
            <Badge variant="outline" className="text-muted-foreground">{kpi.stale} item{kpi.stale > 1 ? "s" : ""} with stale closing</Badge>
          )}
          {!isFG && (computed?.intermediatesExcluded ?? 0) > 0 && (
            <Badge variant="outline" className="text-muted-foreground">{computed!.intermediatesExcluded} intermediates excluded (valued in WIP)</Badge>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div>
          <Label className="text-xs">As of</Label>
          <Input type="date" className="w-40" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
        </div>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            className="pl-8 w-56"
            placeholder={`Search ${isFG ? "item" : "material"} or code…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {isFG && (
          <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer">
            <Switch checked={includeWip} onCheckedChange={setIncludeWip} />
            Include WIP departments
          </label>
        )}
      </div>

      {usingFallback && (
        <div className="text-xs text-amber-600 flex items-start gap-1 border border-amber-200 bg-amber-50 dark:bg-amber-950/20 rounded p-2 mb-4">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            The <code>accounting_inventory_snapshot</code> database function is not deployed yet — showing only items
            with a closing in the last {WINDOW_DAYS} days. Apply the migration for full-history accuracy.
          </span>
        </div>
      )}

      {isLoading && <div className="text-center text-muted-foreground py-10">Loading inventory valuation…</div>}

      {!isLoading && computed && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>Value by {groupLabel}</span>
                  {isFG && (
                    <span className="flex items-center gap-3 text-[11px] font-normal text-muted-foreground">
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary inline-block" />Finished goods</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm inline-block" style={{ background: WIP_COLOR }} />WIP</span>
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={Math.max(160, computed.groups.length * 40)}>
                  <BarChart data={computed.groups} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={fmtRsShort} />
                    <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} width={100} />
                    <Tooltip
                      formatter={(v: any) => fmtRs(Number(v))}
                      labelStyle={{ fontSize: 12 }}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Bar dataKey="value" name="Value" radius={[0, 3, 3, 0]} barSize={18}>
                      {computed.groups.map((g) => (
                        <Cell key={g.key} fill={g.isWip ? WIP_COLOR : "hsl(var(--primary))"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Valuation trend <span className="text-[11px] font-normal text-muted-foreground">last 14 days</span></CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={Math.max(160, computed.groups.length * 40)}>
                  <LineChart data={computed.trend} margin={{ left: 8, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={fmtRsShort} />
                    <Tooltip formatter={(v: any) => fmtRs(Number(v))} labelStyle={{ fontSize: 12 }} contentStyle={{ fontSize: 12 }} />
                    {isFG && includeWip && <Legend wrapperStyle={{ fontSize: 11 }} />}
                    <Line type="monotone" dataKey="main" name={isFG ? "Finished goods" : "Raw material"} stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2 }} />
                    {isFG && includeWip && (
                      <Line type="monotone" dataKey="wip" name="WIP" stroke={WIP_COLOR} strokeWidth={2} dot={{ r: 2 }} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Stock detail by {groupLabel}
                <span className="text-[11px] font-normal text-muted-foreground ml-2">latest closing per {isFG ? "item" : "material"} on or before {asOf}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-8"></TableHead>
                    <TableHead className="text-xs">Code</TableHead>
                    <TableHead className="text-xs">{isFG ? "Item" : "Material"}</TableHead>
                    <TableHead className="text-xs">Unit</TableHead>
                    <TableHead className="text-xs">Closing Date</TableHead>
                    <TableHead className="text-xs text-right">Qty</TableHead>
                    <TableHead className="text-xs text-right">Rate (Rs.)</TableHead>
                    <TableHead className="text-xs text-right">Value (Rs.)</TableHead>
                    <TableHead className="text-xs text-right">% of Total</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scopeGroups.map((g) => {
                    const open = !collapsed.has(g.key);
                    const visible = g.rows.filter(matches);
                    return (
                      <Fragment key={g.key}>
                        <TableRow className="bg-muted/40 cursor-pointer hover:bg-muted/60" onClick={() => toggleGroup(g.key)}>
                          <TableCell className="py-1.5">
                            {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          </TableCell>
                          <TableCell colSpan={4} className="text-xs py-1.5 font-semibold">
                            {g.name}
                            {isFG && (
                              <Badge variant="outline" className="ml-2 text-[9px] text-muted-foreground">{g.isWip ? "WIP" : "Finished goods"}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs py-1.5 text-right font-semibold">{g.qty.toLocaleString()}</TableCell>
                          <TableCell />
                          <TableCell className="text-xs py-1.5 text-right font-semibold">{fmtRs(g.value)}</TableCell>
                          <TableCell className="text-xs py-1.5 text-right text-muted-foreground">
                            {scopeTotal > 0 ? `${((100 * g.value) / scopeTotal).toFixed(1)}%` : "—"}
                          </TableCell>
                          <TableCell className="text-xs py-1.5 text-muted-foreground">{g.rows.length} items</TableCell>
                        </TableRow>
                        {open && visible.map((r) => (
                          <TableRow key={r.id} className={r.below || r.unpriced ? "bg-amber-50 dark:bg-amber-950/20" : undefined}>
                            <TableCell />
                            <TableCell className="text-xs py-1.5 font-mono">{r.code}</TableCell>
                            <TableCell className="text-xs py-1.5 font-medium">{r.name}</TableCell>
                            <TableCell className="text-xs py-1.5">{r.unit}</TableCell>
                            <TableCell className="text-xs py-1.5">{r.closingDate}</TableCell>
                            <TableCell className="text-xs py-1.5 text-right">{r.qty.toLocaleString()}</TableCell>
                            <TableCell className="text-xs py-1.5 text-right">{r.unpriced ? "—" : r.rate.toLocaleString()}</TableCell>
                            <TableCell className="text-xs py-1.5 text-right font-medium">{r.unpriced ? "—" : fmtRs(r.value)}</TableCell>
                            <TableCell className="text-xs py-1.5 text-right text-muted-foreground">
                              {r.unpriced || scopeTotal <= 0 ? "—" : `${((100 * r.value) / scopeTotal).toFixed(1)}%`}
                            </TableCell>
                            <TableCell className="text-xs py-1.5"><StatusBadges r={r} /></TableCell>
                          </TableRow>
                        ))}
                        {open && q && visible.length === 0 && (
                          <TableRow>
                            <TableCell />
                            <TableCell colSpan={9} className="text-xs py-1.5 text-muted-foreground">No match in this {groupLabel}.</TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                  {scopeGroups.length === 0 && (
                    <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No stock closings found on or before {asOf}.</TableCell></TableRow>
                  )}
                  {scopeGroups.length > 0 && (
                    <TableRow className="bg-muted/40 border-t-2">
                      <TableCell />
                      <TableCell colSpan={4} className="text-xs py-2 font-bold">
                        Total{isFG && includeWip ? " (FG + WIP)" : ""}
                      </TableCell>
                      <TableCell className="text-xs py-2 text-right font-bold">{scopeQty.toLocaleString()}</TableCell>
                      <TableCell />
                      <TableCell className="text-xs py-2 text-right font-bold">{fmtRs(scopeTotal)}</TableCell>
                      <TableCell className="text-xs py-2 text-right font-bold">100%</TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
