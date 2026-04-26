import { useState, useEffect, useMemo } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Calculator, TrendingUp, Target, BarChart3 } from "lucide-react";
import { format } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const METRIC_TYPES = [
  { value: "sigma_level", label: "Sigma Level" },
  { value: "dpmo", label: "DPMO" },
  { value: "yield", label: "Yield (%)" },
  { value: "defect_rate", label: "Defect Rate (%)" },
  { value: "cost_savings", label: "Cost Savings (₹)" },
];

// Sigma calculator helper
function calculateSigmaFromDPMO(dpmo: number): number {
  if (dpmo <= 0) return 6;
  if (dpmo >= 1000000) return 0;
  // Approximation using normal distribution
  const lookup: [number, number][] = [
    [6, 3.4], [5.5, 32], [5, 233], [4.5, 1350], [4, 6210],
    [3.5, 22750], [3, 66807], [2.5, 158655], [2, 308538],
    [1.5, 500000], [1, 691462], [0.5, 841345],
  ];
  for (let i = 0; i < lookup.length - 1; i++) {
    if (dpmo <= lookup[i][1]) return lookup[i][0];
    if (dpmo <= lookup[i + 1][1]) {
      const ratio = (dpmo - lookup[i][1]) / (lookup[i + 1][1] - lookup[i][1]);
      return lookup[i][0] - ratio * (lookup[i][0] - lookup[i + 1][0]);
    }
  }
  return 0;
}

function calculateDPMOFromDefects(defects: number, units: number, opportunities: number): number {
  if (units <= 0 || opportunities <= 0) return 0;
  return (defects / (units * opportunities)) * 1000000;
}

export default function SixSigmaMetricsPage() {
  const [metrics, setMetrics] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isCalcOpen, setIsCalcOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState("all");

  const [form, setForm] = useState({
    project_id: "",
    metric_type: "sigma_level",
    metric_value: "",
    measurement_date: format(new Date(), "yyyy-MM-dd"),
    remarks: "",
  });

  const [calc, setCalc] = useState({ defects: "", units: "", opportunities: "" });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const [metRes, projRes] = await Promise.all([
      supabase.from("six_sigma_metrics").select("*, six_sigma_projects(project_number, title)").order("measurement_date", { ascending: true }),
      supabase.from("six_sigma_projects").select("id, project_number, title"),
    ]);
    setMetrics(metRes.data || []);
    setProjects(projRes.data || []);
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!form.project_id || !form.metric_value) {
      toast.error("Project and value are required");
      return;
    }
    const { error } = await supabase.from("six_sigma_metrics").insert({
      project_id: form.project_id,
      metric_type: form.metric_type,
      metric_value: parseFloat(form.metric_value),
      measurement_date: form.measurement_date,
      remarks: form.remarks || null,
    });
    if (error) {
      toast.error(error.message);
      return;
    }

    // Also update current_sigma/dpmo on project
    if (form.metric_type === "sigma_level") {
      await supabase.from("six_sigma_projects").update({ current_sigma: parseFloat(form.metric_value) }).eq("id", form.project_id);
    } else if (form.metric_type === "dpmo") {
      await supabase.from("six_sigma_projects").update({ current_dpmo: parseFloat(form.metric_value) }).eq("id", form.project_id);
    }

    toast.success("Metric recorded!");
    setIsAddOpen(false);
    setForm({ project_id: "", metric_type: "sigma_level", metric_value: "", measurement_date: format(new Date(), "yyyy-MM-dd"), remarks: "" });
    fetchData();
  };

  const calcResult = useMemo(() => {
    const d = parseFloat(calc.defects);
    const u = parseFloat(calc.units);
    const o = parseFloat(calc.opportunities);
    if (!d && d !== 0 || !u || !o) return null;
    const dpmo = calculateDPMOFromDefects(d, u, o);
    const sigma = calculateSigmaFromDPMO(dpmo);
    const yieldPct = ((1 - d / (u * o)) * 100);
    return { dpmo: dpmo.toFixed(0), sigma: sigma.toFixed(2), yield: yieldPct.toFixed(2) };
  }, [calc]);

  const filteredMetrics = selectedProject === "all" ? metrics : metrics.filter((m) => m.project_id === selectedProject);

  const sigmaChartData = useMemo(() => {
    return filteredMetrics
      .filter((m) => m.metric_type === "sigma_level")
      .map((m) => ({
        date: format(new Date(m.measurement_date), "MMM dd"),
        value: m.metric_value,
      }));
  }, [filteredMetrics]);

  const dpmoChartData = useMemo(() => {
    return filteredMetrics
      .filter((m) => m.metric_type === "dpmo")
      .map((m) => ({
        date: format(new Date(m.measurement_date), "MMM dd"),
        value: m.metric_value,
      }));
  }, [filteredMetrics]);

  return (
    <ERPLayout>
      <div className="space-y-4">
        <PageHeader title="Six Sigma Metrics" description="Sigma level, DPMO, yield and savings tracker">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setIsCalcOpen(true)}>
              <Calculator className="mr-2 h-4 w-4" /> Sigma Calculator
            </Button>
            <Button onClick={() => setIsAddOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Record Metric
            </Button>
          </div>
        </PageHeader>

        {/* Filter */}
        <div className="flex gap-3">
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" /> Sigma Level Trend</CardTitle></CardHeader>
            <CardContent>
              {sigmaChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={sigmaChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" className="text-xs" />
                    <YAxis domain={[0, 6]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-muted-foreground text-center py-8">No sigma data yet</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4" /> DPMO Trend</CardTitle></CardHeader>
            <CardContent>
              {dpmoChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={dpmoChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" className="text-xs" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--chart-2))" strokeWidth={2} dot />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-muted-foreground text-center py-8">No DPMO data yet</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Metrics Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Metric</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMetrics.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No metrics recorded</TableCell>
                  </TableRow>
                ) : (
                  [...filteredMetrics].reverse().map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-sm">{format(new Date(m.measurement_date), "dd MMM yyyy")}</TableCell>
                      <TableCell className="text-sm">{m.six_sigma_projects?.project_number || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {METRIC_TYPES.find((t) => t.value === m.metric_type)?.label || m.metric_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono font-medium">{m.metric_value}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{m.remarks || "-"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Add Metric Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Metric</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Project *</Label>
              <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Metric Type</Label>
              <Select value={form.metric_type} onValueChange={(v) => setForm({ ...form, metric_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METRIC_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Value *</Label>
              <Input type="number" step="0.01" value={form.metric_value} onChange={(e) => setForm({ ...form, metric_value: e.target.value })} />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.measurement_date} onChange={(e) => setForm({ ...form, measurement_date: e.target.value })} />
            </div>
            <div>
              <Label>Remarks</Label>
              <Input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd}>Record</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sigma Calculator Dialog */}
      <Dialog open={isCalcOpen} onOpenChange={setIsCalcOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Sigma Level Calculator</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Number of Defects</Label>
              <Input type="number" value={calc.defects} onChange={(e) => setCalc({ ...calc, defects: e.target.value })} />
            </div>
            <div>
              <Label>Number of Units</Label>
              <Input type="number" value={calc.units} onChange={(e) => setCalc({ ...calc, units: e.target.value })} />
            </div>
            <div>
              <Label>Defect Opportunities per Unit</Label>
              <Input type="number" value={calc.opportunities} onChange={(e) => setCalc({ ...calc, opportunities: e.target.value })} />
            </div>
            {calcResult && (
              <Card className="bg-muted">
                <CardContent className="pt-4">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground">DPMO</p>
                      <p className="text-lg font-bold text-primary">{calcResult.dpmo}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Sigma Level</p>
                      <p className="text-lg font-bold text-primary">{calcResult.sigma}σ</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Yield</p>
                      <p className="text-lg font-bold text-primary">{calcResult.yield}%</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
