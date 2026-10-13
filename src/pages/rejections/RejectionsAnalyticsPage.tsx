import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/shared/MetricCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from "recharts";
import { AlertOctagon, Recycle, Coins, TrendingDown, Droplets, ArrowDownWideNarrow, Sigma } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, startOfWeek, startOfMonth } from "date-fns";
import { Button } from "@/components/ui/button";
import { DowngradeDetailDialog, GradeChange } from "@/components/rejections/DowngradeDetailDialog";
import { type Downgrade, dgDb, fmtDate, rs } from "@/lib/rwDowngrades";

export default function RejectionsAnalyticsPage() {
  const [period, setPeriod] = useState<string>("month");
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [viewingDowngrade, setViewingDowngrade] = useState<Downgrade | null>(null);

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const yesterdayStr = format(subDays(new Date(), 1), "yyyy-MM-dd");

  const applyPeriod = (p: string) => {
    const now = new Date();
    if (p === "today") {
      setFromDate(format(now, "yyyy-MM-dd"));
      setToDate(format(now, "yyyy-MM-dd"));
    } else if (p === "yesterday") {
      const y = subDays(now, 1);
      setFromDate(format(y, "yyyy-MM-dd"));
      setToDate(format(y, "yyyy-MM-dd"));
    } else if (p === "week") {
      setFromDate(format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"));
      setToDate(format(now, "yyyy-MM-dd"));
    } else if (p === "month") {
      setFromDate(format(startOfMonth(now), "yyyy-MM-dd"));
      setToDate(format(now, "yyyy-MM-dd"));
    }
    setPeriod(p);
  };

  const { data: depts = [] } = useQuery({
    queryKey: ["an-depts"],
    queryFn: async () => {
      const { data } = await supabase.from("production_departments").select("id, name").eq("is_active", true).order("name");
      return data || [];
    },
  });
  const deptMap = useMemo(() => Object.fromEntries(depts.map((d: any) => [d.id, d.name])), [depts]);

  const { data: materials = [] } = useQuery({
    queryKey: ["an-materials"],
    queryFn: async () => {
      const [{ data: master }, { data: hp }] = await Promise.all([
        (supabase as any).from("rw_materials").select("id, hp_material_id"),
        supabase.from("hp_materials").select("id, name"),
      ]);
      const hpById = new Map<string, string>((hp || []).map((h: any) => [h.id, h.name]));
      const map = new Map<string, string>();
      // Legacy entries pointing directly at hp_materials
      (hp || []).forEach((m: any) => map.set(m.id, m.name));
      // R&W master rows pointing to hp_materials
      (master || []).forEach((m: any) => {
        const name = hpById.get(m.hp_material_id);
        if (name) map.set(m.id, name);
      });
      return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    },
  });
  const matMap = useMemo(() => Object.fromEntries(materials.map((m: any) => [m.id, m.name])), [materials]);

  const { data: reasons = [] } = useQuery({
    queryKey: ["an-reasons"],
    queryFn: async () => {
      const { data } = await supabase.from("rw_reasons").select("id, name, type");
      return data || [];
    },
  });
  const reasonMap = useMemo(() => Object.fromEntries(reasons.map((r: any) => [r.id, r.name])), [reasons]);

  const { data: rejections = [] } = useQuery({
    queryKey: ["an-rej", fromDate, toDate, deptFilter],
    queryFn: async () => {
      let q = supabase.from("rw_rejections").select("*").gte("entry_date", fromDate).lte("entry_date", toDate);
      if (deptFilter !== "all") q = q.eq("department_id", deptFilter);
      const { data } = await q;
      return data || [];
    },
  });

  const { data: wastages = [] } = useQuery({
    queryKey: ["an-wst", fromDate, toDate, deptFilter],
    queryFn: async () => {
      let q = supabase.from("rw_wastages").select("*").gte("entry_date", fromDate).lte("entry_date", toDate);
      if (deptFilter !== "all") q = q.eq("department_id", deptFilter);
      const { data } = await q;
      return data || [];
    },
  });

  const { data: leakages = [] } = useQuery({
    queryKey: ["an-lkg", fromDate, toDate, deptFilter],
    queryFn: async () => {
      let q = (supabase as any).from("rw_leakages").select("*").gte("entry_date", fromDate).lte("entry_date", toDate);
      if (deptFilter !== "all") q = q.eq("department_id", deptFilter);
      const { data } = await q;
      return data || [];
    },
  });

  // Downgrades: an approved form's loss counts on the day it was approved.
  const { data: downgrades = [] } = useQuery({
    queryKey: ["an-dg", fromDate, toDate, deptFilter],
    queryFn: async () => {
      let q = dgDb.from("rw_downgrades").select("*").eq("status", "approved")
        .gte("approved_on", fromDate).lte("approved_on", toDate).order("approved_on", { ascending: false });
      if (deptFilter !== "all") q = q.eq("department_id", deptFilter);
      const { data } = await q;
      return (data || []) as Downgrade[];
    },
  });

  const { data: pendingDowngrades = [] } = useQuery({
    queryKey: ["an-dg-pending", deptFilter],
    queryFn: async () => {
      let q = dgDb.from("rw_downgrades").select("id, cost_loss").eq("status", "pending");
      if (deptFilter !== "all") q = q.eq("department_id", deptFilter);
      const { data } = await q;
      return (data || []) as { id: string; cost_loss: number }[];
    },
  });

  const totalRejQty = rejections.reduce((s: number, r: any) => s + Number(r.rejected_qty || 0), 0);
  const totalRejCost = rejections.reduce((s: number, r: any) => s + Number(r.total_cost || 0), 0);
  const totalWstQty = wastages.reduce((s: number, w: any) => s + Number(w.wasted_qty || 0), 0);
  const totalWstCost = wastages.reduce((s: number, w: any) => s + Number(w.total_cost || 0), 0);
  const totalLkgQty = leakages.reduce((s: number, l: any) => s + Number(l.leaked_qty || 0), 0);
  const totalLkgCost = leakages.reduce((s: number, l: any) => s + Number(l.total_cost || 0), 0);
  const totalDgQty = downgrades.reduce((s, d) => s + Number(d.quantity || 0), 0);
  const totalDgCost = downgrades.reduce((s, d) => s + Number(d.cost_loss || 0), 0);
  const pendingDgCost = pendingDowngrades.reduce((s, d) => s + Number(d.cost_loss || 0), 0);
  const totalLoss = totalRejCost + totalWstCost + totalLkgCost + totalDgCost;
  const lossParts = [
    { label: "Rejection", value: totalRejCost, color: "#ef4444" },
    { label: "Wastage", value: totalWstCost, color: "#f59e0b" },
    { label: "Leakage", value: totalLkgCost, color: "#6366f1" },
    { label: "Downgrade", value: totalDgCost, color: "#10b981" },
  ];

  // Daily trend
  const dailyTrend = useMemo(() => {
    type Day = { date: string; rejQty: number; wstCost: number; lkgQty: number; lkgCost: number; dgCost: number };
    const map: Record<string, Day> = {};
    const day = (k: string) => (map[k] = map[k] || { date: k, rejQty: 0, wstCost: 0, lkgQty: 0, lkgCost: 0, dgCost: 0 });
    rejections.forEach((r: any) => {
      const k = r.entry_date;
      day(k);
      map[k].rejQty += Number(r.rejected_qty || 0);
    });
    wastages.forEach((w: any) => {
      const k = w.entry_date;
      day(k);
      map[k].wstCost += Number(w.total_cost || 0);
    });
    leakages.forEach((l: any) => {
      const k = l.entry_date;
      day(k);
      map[k].lkgQty += Number(l.leaked_qty || 0);
      map[k].lkgCost += Number(l.total_cost || 0);
    });
    downgrades.forEach((d) => {
      if (!d.approved_on) return;
      day(d.approved_on).dgCost += Number(d.cost_loss || 0);
    });
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date)).map(d => ({ ...d, date: format(new Date(d.date), "dd MMM") }));
  }, [rejections, wastages, leakages, downgrades]);

  // By department
  const byDept = useMemo(() => {
    type Row = { dept: string; rejected: number; wastageCost: number; leakageQty: number; leakageCost: number; downgradeCost: number };
    const map: Record<string, Row> = {};
    const row = (k: string) =>
      (map[k] = map[k] || { dept: deptMap[k] || "—", rejected: 0, wastageCost: 0, leakageQty: 0, leakageCost: 0, downgradeCost: 0 });
    rejections.forEach((r: any) => {
      const k = r.department_id || "none";
      row(k);
      map[k].rejected += Number(r.rejected_qty || 0);
    });
    wastages.forEach((w: any) => {
      const k = w.department_id || "none";
      row(k);
      map[k].wastageCost += Number(w.total_cost || 0);
    });
    leakages.forEach((l: any) => {
      const k = l.department_id || "none";
      row(k);
      map[k].leakageQty += Number(l.leaked_qty || 0);
      map[k].leakageCost += Number(l.total_cost || 0);
    });
    downgrades.forEach((d) => {
      row(d.department_id || "none").downgradeCost += Number(d.cost_loss || 0);
    });
    return Object.values(map);
  }, [rejections, wastages, leakages, downgrades, deptMap]);

  // Downgrade loss by grade change (e.g. T → VM)
  const byGradeChange = useMemo(() => {
    const map: Record<string, { from: string; to: string; forms: number; qty: number; cost: number }> = {};
    downgrades.forEach((d) => {
      const k = `${d.original_grade_name}→${d.proposed_grade_name}`;
      map[k] = map[k] || { from: d.original_grade_name, to: d.proposed_grade_name, forms: 0, qty: 0, cost: 0 };
      map[k].forms += 1;
      map[k].qty += Number(d.quantity || 0);
      map[k].cost += Number(d.cost_loss || 0);
    });
    return Object.values(map).sort((a, b) => b.cost - a.cost);
  }, [downgrades]);

  // Top wastage materials by Rs.
  const topMaterials = useMemo(() => {
    const map: Record<string, { material: string; qty: number; cost: number }> = {};
    wastages.forEach((w: any) => {
      const k = w.material_id || "none";
      map[k] = map[k] || { material: matMap[k] || "—", qty: 0, cost: 0 };
      map[k].qty += Number(w.wasted_qty || 0);
      map[k].cost += Number(w.total_cost || 0);
    });
    return Object.values(map).sort((a, b) => b.cost - a.cost).slice(0, 10);
  }, [wastages, matMap]);

  // Top rejection materials by Rs.
  const topRejMaterials = useMemo(() => {
    const map: Record<string, { material: string; qty: number; cost: number }> = {};
    rejections.forEach((r: any) => {
      const k = r.material_id || "none";
      map[k] = map[k] || { material: matMap[k] || "—", qty: 0, cost: 0 };
      map[k].qty += Number(r.rejected_qty || 0);
      map[k].cost += Number(r.total_cost || 0);
    });
    return Object.values(map).sort((a, b) => b.cost - a.cost).slice(0, 10);
  }, [rejections, matMap]);

  // Top leakage materials by Rs.
  const topLkgMaterials = useMemo(() => {
    const map: Record<string, { material: string; qty: number; cost: number }> = {};
    leakages.forEach((l: any) => {
      const k = l.material_id || "none";
      map[k] = map[k] || { material: matMap[k] || "—", qty: 0, cost: 0 };
      map[k].qty += Number(l.leaked_qty || 0);
      map[k].cost += Number(l.total_cost || 0);
    });
    return Object.values(map).sort((a, b) => b.cost - a.cost).slice(0, 10);
  }, [leakages, matMap]);

  // Reason breakdown
  const reasonBreakdown = useMemo(() => {
    const map: Record<string, { reason: string; type: string; qty: number; cost: number; count: number }> = {};
    rejections.forEach((r: any) => {
      const k = (r.reason_id || "none") + "::r";
      map[k] = map[k] || { reason: reasonMap[r.reason_id] || "—", type: "rejection", qty: 0, cost: 0, count: 0 };
      map[k].qty += Number(r.rejected_qty || 0);
      map[k].cost += Number(r.total_cost || 0);
      map[k].count += 1;
    });
    wastages.forEach((w: any) => {
      const k = (w.reason_id || "none") + "::w";
      map[k] = map[k] || { reason: reasonMap[w.reason_id] || "—", type: "wastage", qty: 0, cost: 0, count: 0 };
      map[k].qty += Number(w.wasted_qty || 0);
      map[k].cost += Number(w.total_cost || 0);
      map[k].count += 1;
    });
    leakages.forEach((l: any) => {
      const k = (l.reason_id || "none") + "::l";
      map[k] = map[k] || { reason: reasonMap[l.reason_id] || "—", type: "leakage", qty: 0, cost: 0, count: 0 };
      map[k].qty += Number(l.leaked_qty || 0);
      map[k].cost += Number(l.total_cost || 0);
      map[k].count += 1;
    });
    return Object.values(map).sort((a, b) => b.cost - a.cost);
  }, [rejections, wastages, leakages, reasonMap]);

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Rejections & Wastages Analytics"
          description="Trends, top reasons and cost impact"
          icon={TrendingDown}
          iconColor="bg-amber-500 text-white"
        />

        <Card>
          <CardContent className="p-3 md:p-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Period</Label>
              <Select value={period} onValueChange={applyPeriod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="yesterday">Yesterday</SelectItem>
                  <SelectItem value="week">This Week</SelectItem>
                  <SelectItem value="month">This Month</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPeriod("custom"); }} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPeriod("custom"); }} />
            </div>
            <div>
              <Label className="text-xs">Department</Label>
              <Select value={deptFilter} onValueChange={setDeptFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {depts.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard title="Rejected Qty" value={totalRejQty.toLocaleString()} icon={AlertOctagon} />
          <MetricCard title="Rejection Cost" value={`Rs. ${totalRejCost.toLocaleString()}`} icon={Coins} />
          <MetricCard title="Wastage Qty" value={totalWstQty.toLocaleString()} icon={Recycle} />
          <MetricCard title="Wastage Cost" value={`Rs. ${totalWstCost.toLocaleString()}`} icon={Coins} />
          <MetricCard title="Leakage Qty" value={totalLkgQty.toLocaleString()} icon={Droplets} />
          <MetricCard title="Leakage Cost" value={`Rs. ${totalLkgCost.toLocaleString()}`} icon={Coins} />
          <MetricCard title="Downgraded Qty" value={totalDgQty.toLocaleString()} icon={ArrowDownWideNarrow}
            description={`${downgrades.length} approved form${downgrades.length === 1 ? "" : "s"}`} />
          <MetricCard title="Downgrade Loss" value={rs(totalDgCost)} icon={Coins}
            description={pendingDowngrades.length ? `+ ${rs(pendingDgCost)} pending approval (not counted)` : "Approved forms only"} />
        </div>

        <Card>
          <CardHeader className="p-3 md:p-4 pb-2 md:pb-2">
            <CardTitle className="text-base flex flex-wrap items-center gap-2">
              <Sigma className="h-4 w-4 text-muted-foreground" /> Total R&amp;W Loss
              <span className="text-xs font-normal text-muted-foreground">Rejection + Wastage + Leakage + Downgrade</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4 pt-0 md:pt-0 space-y-2">
            <div className="font-display text-2xl font-semibold tabular-nums">{rs(totalLoss)}</div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
              {totalLoss > 0 && lossParts.map((p) => (
                <div key={p.label} style={{ width: `${(p.value / totalLoss) * 100}%`, background: p.color }} title={p.label} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {lossParts.map((p) => (
                <span key={p.label} className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
                  {p.label} {rs(p.value)}
                  {totalLoss > 0 && <span>· {((p.value / totalLoss) * 100).toFixed(1)}%</span>}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 md:p-4"><CardTitle className="text-base">Daily Trend</CardTitle></CardHeader>
          <CardContent className="p-3 md:p-4 pt-0">
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="rejQty" name="Rejected Qty" stroke="#ef4444" />
                  <Line type="monotone" dataKey="wstCost" name="Wastage Rs." stroke="#f59e0b" />
                  <Line type="monotone" dataKey="lkgQty" name="Leakage Qty" stroke="#3b82f6" />
                  <Line type="monotone" dataKey="lkgCost" name="Leakage Rs." stroke="#6366f1" />
                  <Line type="monotone" dataKey="dgCost" name="Downgrade Rs." stroke="#10b981" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 md:p-4"><CardTitle className="text-base">By Department</CardTitle></CardHeader>
          <CardContent className="p-3 md:p-4 pt-0">
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byDept}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="dept" fontSize={11} interval={0} angle={-15} textAnchor="end" height={50} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="rejected" name="Rejected Qty" fill="#ef4444" />
                  <Bar dataKey="wastageCost" name="Wastage Rs." fill="#f59e0b" />
                  <Bar dataKey="leakageCost" name="Leakage Rs." fill="#6366f1" />
                  <Bar dataKey="downgradeCost" name="Downgrade Rs." fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 md:p-4"><CardTitle className="text-base">Top Wastage Materials (Rs.)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right">Wasted Qty</TableHead>
                  <TableHead className="text-right">Cost (Rs.)</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {topMaterials.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No wastage data.</TableCell></TableRow>}
                  {topMaterials.map((m, i) => (
                    <TableRow key={i}>
                      <TableCell>{m.material}</TableCell>
                      <TableCell className="text-right">{m.qty.toLocaleString()}</TableCell>
                      <TableCell className="text-right">Rs. {m.cost.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 md:p-4"><CardTitle className="text-base">Top Rejection Materials (Rs.)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right">Rejected Qty</TableHead>
                  <TableHead className="text-right">Cost (Rs.)</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {topRejMaterials.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No rejection data.</TableCell></TableRow>}
                  {topRejMaterials.map((m, i) => (
                    <TableRow key={i}>
                      <TableCell>{m.material}</TableCell>
                      <TableCell className="text-right">{m.qty.toLocaleString()}</TableCell>
                      <TableCell className="text-right">Rs. {m.cost.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 md:p-4"><CardTitle className="text-base">Top Leakage Materials (Rs.)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right">Leaked Qty</TableHead>
                  <TableHead className="text-right">Cost (Rs.)</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {topLkgMaterials.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No leakage data.</TableCell></TableRow>}
                  {topLkgMaterials.map((m, i) => (
                    <TableRow key={i}>
                      <TableCell>{m.material}</TableCell>
                      <TableCell className="text-right">{m.qty.toLocaleString()}</TableCell>
                      <TableCell className="text-right">Rs. {m.cost.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>


        <Card>
          <CardHeader className="p-3 md:p-4"><CardTitle className="text-base">Top Downgrades by Grade Change (Rs.)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Grade change</TableHead>
                  <TableHead className="text-right">Forms</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Loss (Rs.)</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {byGradeChange.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No approved downgrades in this period.</TableCell></TableRow>}
                  {byGradeChange.map((g) => (
                    <TableRow key={`${g.from}→${g.to}`}>
                      <TableCell><GradeChange from={g.from} to={g.to} /></TableCell>
                      <TableCell className="text-right">{g.forms}</TableCell>
                      <TableCell className="text-right">{g.qty.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{rs(g.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 md:p-4"><CardTitle className="text-base">Downgrade Register</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>DG No.</TableHead>
                  <TableHead>Approved</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Grade change</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Loss (Rs.)</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {downgrades.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No approved downgrades in this period.</TableCell></TableRow>}
                  {downgrades.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <Button variant="link" className="h-auto p-0 font-display font-semibold" onClick={() => setViewingDowngrade(d)}>
                          {d.downgrade_no}
                        </Button>
                      </TableCell>
                      <TableCell>{fmtDate(d.approved_on)}</TableCell>
                      <TableCell>{d.department_name || "—"}</TableCell>
                      <TableCell>{d.item_name}</TableCell>
                      <TableCell><GradeChange from={d.original_grade_name} to={d.proposed_grade_name} /></TableCell>
                      <TableCell className="text-right">{Number(d.quantity).toLocaleString()} {d.unit}</TableCell>
                      <TableCell className="text-right">{rs(d.cost_loss)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <DowngradeDetailDialog downgrade={viewingDowngrade} onOpenChange={(o) => !o && setViewingDowngrade(null)} />

        <Card>
          <CardHeader className="p-3 md:p-4"><CardTitle className="text-base">Reason Breakdown</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Reason</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Cost (Rs.)</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {reasonBreakdown.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No data.</TableCell></TableRow>}
                  {reasonBreakdown.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.reason}</TableCell>
                      <TableCell className="capitalize">{r.type}</TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell className="text-right">{r.qty.toLocaleString()}</TableCell>
                      <TableCell className="text-right">Rs. {r.cost.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
