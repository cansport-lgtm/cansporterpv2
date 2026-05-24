import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FileText, Trash2, Plus, TrendingDown } from "lucide-react";
import { format, subDays } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
  CartesianGrid,
  Legend,
} from "recharts";

const HOUR_LABEL = (h: number) => {
  const start = h % 12 === 0 ? 12 : h % 12;
  const end = (h + 1) % 12 === 0 ? 12 : (h + 1) % 12;
  const startAmPm = h < 12 ? "AM" : "PM";
  const endAmPm = (h + 1) < 12 || (h + 1) === 24 ? "AM" : "PM";
  return `${start}:00 ${startAmPm}–${end}:00 ${endAmPm}`;
};

export default function HourlyProductionLossLogsPage() {
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const qc = useQueryClient();

  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 7), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [departmentId, setDepartmentId] = useState<string>("all");
  const [processFilter, setProcessFilter] = useState<string>("all");
  const [reasonFilter, setReasonFilter] = useState<string>("all");

  const { data: departments = [] } = useQuery({
    queryKey: ["production-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: lossReasons = [] } = useQuery({
    queryKey: ["hourly-loss-reasons-all"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hourly_loss_reasons")
        .select("id, name, category")
        .order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: legacyReasons = [] } = useQuery({
    queryKey: ["downtime-reasons-all"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("downtime_reasons")
        .select("id, name, category")
        .order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const reasons = useMemo(
    () => [...lossReasons, ...legacyReasons],
    [lossReasons, legacyReasons],
  );

  const { data: users = [] } = useQuery({
    queryKey: ["app-users-list"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("app_users")
        .select("id, full_name, user_id");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: losses = [], isLoading } = useQuery({
    queryKey: ["hourly-losses-logs", fromDate, toDate, departmentId, processFilter, reasonFilter],
    queryFn: async () => {
      let q = (supabase as any)
        .from("hourly_production_losses")
        .select("*")
        .gte("entry_date", fromDate)
        .lte("entry_date", toDate)
        .order("entry_date", { ascending: false })
        .order("hour_slot", { ascending: false });
      if (departmentId !== "all") q = q.eq("department_id", departmentId);
      if (processFilter !== "all") q = q.eq("process_name", processFilter);
      if (reasonFilter !== "all") {
        // Match either new loss_reason_id or legacy reason_id
        q = q.or(`loss_reason_id.eq.${reasonFilter},reason_id.eq.${reasonFilter}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const reasonMap = useMemo(
    () => Object.fromEntries(reasons.map((r: any) => [r.id, r.name])),
    [reasons],
  );
  const deptMap = useMemo(
    () => Object.fromEntries(departments.map((d: any) => [d.id, d.name])),
    [departments],
  );
  const userMap = useMemo(
    () => Object.fromEntries(users.map((u: any) => [u.id, u.full_name || u.user_id])),
    [users],
  );

  const processOptions = useMemo(
    () => Array.from(new Set(losses.map((l: any) => l.process_name))).sort() as string[],
    [losses],
  );

  // KPIs
  const totalMinutes = losses.reduce((s, l: any) => s + Number(l.lost_minutes || 0), 0);
  const totalQty = losses.reduce((s, l: any) => s + Number(l.lost_quantity || 0), 0);

  const reasonAgg = useMemo(() => {
    const map: Record<string, { name: string; minutes: number; qty: number; count: number }> = {};
    losses.forEach((l: any) => {
      const name = reasonMap[l.loss_reason_id] || reasonMap[l.reason_id] || "Unknown";
      if (!map[name]) map[name] = { name, minutes: 0, qty: 0, count: 0 };
      map[name].minutes += Number(l.lost_minutes || 0);
      map[name].qty += Number(l.lost_quantity || 0);
      map[name].count += 1;
    });
    return Object.values(map).sort((a, b) => b.minutes - a.minutes);
  }, [losses, reasonMap]);

  const processAgg = useMemo(() => {
    const map: Record<string, { name: string; minutes: number; qty: number; count: number }> = {};
    losses.forEach((l: any) => {
      const name = l.process_name || "Unknown";
      if (!map[name]) map[name] = { name, minutes: 0, qty: 0, count: 0 };
      map[name].minutes += Number(l.lost_minutes || 0);
      map[name].qty += Number(l.lost_quantity || 0);
      map[name].count += 1;
    });
    return Object.values(map).sort((a, b) => b.minutes - a.minutes);
  }, [losses]);

  const topReason = reasonAgg[0]?.name || "—";
  const topProcess = processAgg[0]?.name || "—";

  // Pareto: cumulative %
  const paretoData = useMemo(() => {
    const total = reasonAgg.reduce((s, r) => s + r.minutes, 0) || 1;
    let cum = 0;
    return reasonAgg.map((r) => {
      cum += r.minutes;
      return {
        name: r.name,
        minutes: r.minutes,
        cumulativePct: Number(((cum / total) * 100).toFixed(1)),
      };
    });
  }, [reasonAgg]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("hourly_production_losses")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Loss entry deleted");
      qc.invalidateQueries({ queryKey: ["hourly-losses-logs"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <PageHeader
            title="Hourly Loss Logs"
            description="Track and analyse production hour losses"
            icon={FileText}
            iconColor="bg-amber-600 text-white"
          />
          <Button asChild>
            <Link to="/hourly-production/loss-entry">
              <Plus className="h-4 w-4 mr-2" /> Log New Loss
            </Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
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
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {departments.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Process</Label>
                <Select value={processFilter} onValueChange={setProcessFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {processOptions.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reason</Label>
                <Select value={reasonFilter} onValueChange={setReasonFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {lossReasons.map((r: any) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">Total Lost Minutes</p>
              <p className="text-2xl font-bold text-amber-600">{totalMinutes.toFixed(0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">Total Lost Quantity</p>
              <p className="text-2xl font-bold">{totalQty.toFixed(0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">Top Reason</p>
              <p className="text-lg font-semibold truncate" title={topReason}>{topReason}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">Most Affected Process</p>
              <p className="text-lg font-semibold truncate" title={topProcess}>{topProcess}</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="logs">
          <TabsList>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="logs">
            <Card>
              <CardHeader>
                <CardTitle>Loss Records</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Hour</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Process</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead className="text-right">Lost Min</TableHead>
                        <TableHead className="text-right">Lost Qty</TableHead>
                        <TableHead>Remarks</TableHead>
                        <TableHead>Logged By</TableHead>
                        {isSuperAdmin && <TableHead className="w-12"></TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? (
                        <TableRow><TableCell colSpan={isSuperAdmin ? 10 : 9} className="text-center py-8">Loading...</TableCell></TableRow>
                      ) : losses.length === 0 ? (
                        <TableRow><TableCell colSpan={isSuperAdmin ? 10 : 9} className="text-center py-8 text-muted-foreground">No losses found in this range</TableCell></TableRow>
                      ) : (
                        losses.map((l: any) => (
                          <TableRow key={l.id}>
                            <TableCell>{format(new Date(l.entry_date), "dd MMM yyyy")}</TableCell>
                            <TableCell className="text-xs">{HOUR_LABEL(l.hour_slot)}</TableCell>
                            <TableCell>{deptMap[l.department_id] || "—"}</TableCell>
                            <TableCell>{l.process_name}</TableCell>
                            <TableCell>{reasonMap[l.loss_reason_id] || reasonMap[l.reason_id] || "—"}</TableCell>
                            <TableCell className="text-right font-medium text-amber-600">{Number(l.lost_minutes || 0)}</TableCell>
                            <TableCell className="text-right">{Number(l.lost_quantity || 0)}</TableCell>
                            <TableCell className="max-w-xs truncate" title={l.remarks || ""}>{l.remarks || "—"}</TableCell>
                            <TableCell className="text-xs">{userMap[l.created_by] || "—"}</TableCell>
                            {isSuperAdmin && (
                              <TableCell>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon">
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete loss record?</AlertDialogTitle>
                                      <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => deleteMutation.mutate(l.id)}>
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </TableCell>
                            )}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analytics">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingDown className="h-5 w-5 text-amber-600" /> Pareto — Lost Minutes by Reason
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {paretoData.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">No data</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart data={paretoData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={80} />
                        <YAxis yAxisId="left" />
                        <YAxis yAxisId="right" orientation="right" domain={[0, 100]} />
                        <Tooltip />
                        <Legend />
                        <Bar yAxisId="left" dataKey="minutes" fill="hsl(var(--primary))" name="Lost Minutes" />
                        <Line yAxisId="right" type="monotone" dataKey="cumulativePct" stroke="#dc2626" name="Cumulative %" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Reason-wise Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reason</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                        <TableHead className="text-right">Min</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">% Min</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reasonAgg.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No data</TableCell></TableRow>
                      ) : (
                        reasonAgg.map((r) => (
                          <TableRow key={r.name}>
                            <TableCell>{r.name}</TableCell>
                            <TableCell className="text-right">{r.count}</TableCell>
                            <TableCell className="text-right font-medium">{r.minutes.toFixed(0)}</TableCell>
                            <TableCell className="text-right">{r.qty.toFixed(0)}</TableCell>
                            <TableCell className="text-right">
                              {totalMinutes > 0 ? ((r.minutes / totalMinutes) * 100).toFixed(1) : "0"}%
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Process-wise Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Process</TableHead>
                        <TableHead className="text-right">Loss Events</TableHead>
                        <TableHead className="text-right">Lost Min</TableHead>
                        <TableHead className="text-right">Lost Qty</TableHead>
                        <TableHead className="text-right">% of Total Min</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {processAgg.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No data</TableCell></TableRow>
                      ) : (
                        processAgg.map((p) => (
                          <TableRow key={p.name}>
                            <TableCell>{p.name}</TableCell>
                            <TableCell className="text-right">{p.count}</TableCell>
                            <TableCell className="text-right font-medium text-amber-600">{p.minutes.toFixed(0)}</TableCell>
                            <TableCell className="text-right">{p.qty.toFixed(0)}</TableCell>
                            <TableCell className="text-right">
                              {totalMinutes > 0 ? ((p.minutes / totalMinutes) * 100).toFixed(1) : "0"}%
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </ERPLayout>
  );
}
