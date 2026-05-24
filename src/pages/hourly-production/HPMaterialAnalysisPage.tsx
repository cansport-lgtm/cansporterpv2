import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, Download } from "lucide-react";
import { format } from "date-fns";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";

const ALL = "all";

export default function HPMaterialAnalysisPage() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [departmentId, setDepartmentId] = useState<string>(ALL);
  const [materialId, setMaterialId] = useState<string>(ALL);
  const [trendMaterial, setTrendMaterial] = useState<string>("");

  const { data: depts = [] } = useQuery({
    queryKey: ["hp-ana-depts"],
    queryFn: async () => {
      const { data: el } = await supabase.from("job_order_eligible_departments").select("department_id");
      const ids = (el || []).map((r: any) => r.department_id);
      if (!ids.length) return [];
      const { data } = await supabase.from("production_departments").select("id, name").in("id", ids).eq("is_active", true).order("name");
      return data || [];
    },
  });

  const { data: materials = [] } = useQuery({
    queryKey: ["hp-ana-materials"],
    queryFn: async () => {
      const { data } = await supabase.from("hp_materials").select("id, code, name, unit").order("code");
      return data || [];
    },
  });
  const materialMap = useMemo(() => Object.fromEntries(materials.map((m: any) => [m.id, m])), [materials]);
  const deptMap = useMemo(() => Object.fromEntries(depts.map((d: any) => [d.id, d])), [depts]);

  // Fetch headers in range
  const { data: headers = [] } = useQuery({
    queryKey: ["hp-ana-headers", fromDate, toDate, departmentId],
    queryFn: async () => {
      let q = supabase.from("hp_material_issuance").select("id, issue_date, department_id").gte("issue_date", fromDate).lte("issue_date", toDate);
      if (departmentId !== ALL) q = q.eq("department_id", departmentId);
      const { data } = await q;
      return data || [];
    },
  });
  const headerIds = headers.map((h: any) => h.id);
  const headerMap = useMemo(() => Object.fromEntries(headers.map((h: any) => [h.id, h])), [headers]);

  const { data: items = [] } = useQuery({
    queryKey: ["hp-ana-items", headerIds.join(",")],
    queryFn: async () => {
      if (!headerIds.length) return [];
      const { data } = await supabase.from("hp_material_issuance_items").select("*").in("issuance_id", headerIds).in("status", ["accepted", "closed"]);
      return data || [];
    },
    enabled: headerIds.length > 0,
  });

  // Filter by material
  const filteredItems = useMemo(() => {
    return (items as any[]).filter(it => materialId === ALL || it.material_id === materialId);
  }, [items, materialId]);

  // Variance aggregation
  const varianceRows = useMemo(() => {
    const byMat: Record<string, { issued: number; consumed: number }> = {};
    for (const it of filteredItems) {
      const m = it.material_id;
      if (!byMat[m]) byMat[m] = { issued: 0, consumed: 0 };
      byMat[m].issued += Number(it.issued_qty || 0);
      byMat[m].consumed += Number(it.consumed_qty || 0);
    }
    return Object.entries(byMat).map(([mid, v]) => {
      const balance = v.issued - v.consumed;
      const variance = v.issued > 0 ? (balance / v.issued) * 100 : 0;
      return { material_id: mid, ...v, balance, variance };
    }).sort((a, b) => (materialMap[a.material_id]?.code || "").localeCompare(materialMap[b.material_id]?.code || ""));
  }, [filteredItems, materialMap]);

  const totals = useMemo(() => {
    const issued = varianceRows.reduce((s, r) => s + r.issued, 0);
    const consumed = varianceRows.reduce((s, r) => s + r.consumed, 0);
    const variance = issued > 0 ? ((issued - consumed) / issued) * 100 : 0;
    return { issued, consumed, variance, count: varianceRows.length };
  }, [varianceRows]);

  // Trends — pick first material if none selected
  const trendMat = trendMaterial || varianceRows[0]?.material_id || "";
  const trendData = useMemo(() => {
    if (!trendMat) return [];
    const byDate: Record<string, { date: string; issued: number; consumed: number }> = {};
    for (const it of items as any[]) {
      if (it.material_id !== trendMat) continue;
      const h = headerMap[it.issuance_id];
      if (!h) continue;
      const d = h.issue_date;
      if (!byDate[d]) byDate[d] = { date: d, issued: 0, consumed: 0 };
      byDate[d].issued += Number(it.issued_qty || 0);
      byDate[d].consumed += Number(it.consumed_qty || 0);
    }
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)).map(d => ({
      ...d,
      balance: d.issued - d.consumed,
    }));
  }, [items, headerMap, trendMat]);

  // Department summary pivot
  const pivot = useMemo(() => {
    const deptIds = Array.from(new Set(filteredItems.map(it => headerMap[it.issuance_id]?.department_id).filter(Boolean)));
    const matIds = Array.from(new Set(filteredItems.map(it => it.material_id)));
    const cell: Record<string, number> = {};
    for (const it of filteredItems) {
      const d = headerMap[it.issuance_id]?.department_id;
      if (!d) continue;
      const key = `${it.material_id}::${d}`;
      cell[key] = (cell[key] || 0) + Number(it.consumed_qty || 0);
    }
    return { deptIds, matIds, cell };
  }, [filteredItems, headerMap]);

  const exportCSV = () => {
    const headers = ["Material Code", "Material", "Unit", ...pivot.deptIds.map(d => deptMap[d]?.name || d), "Total"];
    const lines = [headers.join(",")];
    for (const mid of pivot.matIds) {
      const m = materialMap[mid];
      const row = [m?.code || "", m?.name || "", m?.unit || ""];
      let total = 0;
      for (const d of pivot.deptIds) {
        const v = pivot.cell[`${mid}::${d}`] || 0;
        total += v;
        row.push(v.toFixed(2));
      }
      row.push(total.toFixed(2));
      lines.push(row.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `material-analysis-${fromDate}-to-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const varianceColor = (v: number) => {
    const a = Math.abs(v);
    if (a <= 5) return "text-green-600";
    if (a <= 15) return "text-amber-600";
    return "text-red-600";
  };

  return (
    <ERPLayout>
      <PageHeader title="Material Analysis" description="Issued vs consumed analytics across selected date range" icon={BarChart3} />

      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div><Label>From Date</Label><Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
            <div><Label>To Date</Label><Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
            <div>
              <Label>Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Departments</SelectItem>
                  {depts.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Material</Label>
              <Select value={materialId} onValueChange={setMaterialId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Materials</SelectItem>
                  {materials.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.code} — {m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Total Issued</div><div className="text-2xl font-bold">{totals.issued.toFixed(2)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Total Consumed</div><div className="text-2xl font-bold">{totals.consumed.toFixed(2)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Overall Variance %</div><div className={`text-2xl font-bold ${varianceColor(totals.variance)}`}>{totals.variance.toFixed(2)}%</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Materials Tracked</div><div className="text-2xl font-bold">{totals.count}</div></CardContent></Card>
      </div>

      <Tabs defaultValue="variance" className="mt-4">
        <TabsList>
          <TabsTrigger value="variance">Variance</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="dept">Department Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="variance">
          <Card>
            <CardContent className="pt-6">
              {varianceRows.length === 0 ? (
                <p className="text-muted-foreground text-sm">No accepted issuances in selected range.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Issued</TableHead>
                      <TableHead className="text-right">Consumed</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right">Variance %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {varianceRows.map(r => {
                      const m = materialMap[r.material_id];
                      return (
                        <TableRow key={r.material_id}>
                          <TableCell className="font-mono">{m?.code}</TableCell>
                          <TableCell className="font-medium">{m?.name}</TableCell>
                          <TableCell>{m?.unit}</TableCell>
                          <TableCell className="text-right">{r.issued.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{r.consumed.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{r.balance.toFixed(2)}</TableCell>
                          <TableCell className={`text-right font-semibold ${varianceColor(r.variance)}`}>{r.variance.toFixed(2)}%</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle>Daily Trend</CardTitle>
                <div className="w-72">
                  <Select value={trendMat} onValueChange={setTrendMaterial}>
                    <SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger>
                    <SelectContent>
                      {varianceRows.map(r => {
                        const m = materialMap[r.material_id];
                        return <SelectItem key={r.material_id} value={r.material_id}>{m?.code} — {m?.name}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {trendData.length === 0 ? (
                <p className="text-muted-foreground text-sm">No data for selected material.</p>
              ) : (
                <>
                  <div className="h-72">
                    <ResponsiveContainer>
                      <LineChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="issued" stroke="hsl(var(--primary))" name="Issued" />
                        <Line type="monotone" dataKey="consumed" stroke="hsl(var(--destructive))" name="Consumed" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="h-64 mt-6">
                    <ResponsiveContainer>
                      <BarChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="balance" fill="hsl(var(--accent-foreground))" name="Daily Balance" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dept">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Consumed by Department</CardTitle>
                <Button variant="outline" size="sm" onClick={exportCSV} disabled={pivot.matIds.length === 0}>
                  <Download className="h-4 w-4 mr-2" /> Export CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {pivot.matIds.length === 0 ? (
                <p className="text-muted-foreground text-sm">No data in selected range.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Material</TableHead>
                        {pivot.deptIds.map(d => <TableHead key={d} className="text-right">{deptMap[d]?.name || d}</TableHead>)}
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pivot.matIds.map(mid => {
                        const m = materialMap[mid];
                        let rowTotal = 0;
                        const cells = pivot.deptIds.map(d => {
                          const v = pivot.cell[`${mid}::${d}`] || 0;
                          rowTotal += v;
                          return v;
                        });
                        return (
                          <TableRow key={mid}>
                            <TableCell className="font-mono">{m?.code}</TableCell>
                            <TableCell className="font-medium">{m?.name}</TableCell>
                            {cells.map((v, i) => <TableCell key={i} className="text-right">{v.toFixed(2)}</TableCell>)}
                            <TableCell className="text-right font-semibold">{rowTotal.toFixed(2)}</TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="bg-muted/50 font-semibold">
                        <TableCell colSpan={2}>Total</TableCell>
                        {pivot.deptIds.map(d => {
                          const t = pivot.matIds.reduce((s, mid) => s + (pivot.cell[`${mid}::${d}`] || 0), 0);
                          return <TableCell key={d} className="text-right">{t.toFixed(2)}</TableCell>;
                        })}
                        <TableCell className="text-right">
                          {pivot.matIds.reduce((s, mid) => s + pivot.deptIds.reduce((ss, d) => ss + (pivot.cell[`${mid}::${d}`] || 0), 0), 0).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </ERPLayout>
  );
}
