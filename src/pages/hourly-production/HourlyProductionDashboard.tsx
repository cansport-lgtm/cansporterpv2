import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Factory, BarChart3, Users, CalendarIcon } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const HOUR_LABELS: Record<number, string> = {};
for (let i = 0; i < 24; i++) {
  const h = i % 12 === 0 ? 12 : i % 12;
  const ampm = i < 12 ? "AM" : "PM";
  HOUR_LABELS[i] = `${h}${ampm}`;
}

export default function HourlyProductionDashboard() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const today = format(selectedDate, "yyyy-MM-dd");
  const isToday = today === format(new Date(), "yyyy-MM-dd");
  const dateLabel = isToday ? "Today" : format(selectedDate, "PPP");

  const { data: entries = [] } = useQuery({
    queryKey: ["hourly-production-entries-today", today],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hourly_production_entries")
        .select("*")
        .eq("entry_date", today);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: processes = [] } = useQuery({
    queryKey: ["qa-processes-hourly"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("qa_processes")
        .select("id, name, code, department_id, production_departments(id, name)")
        .eq("is_active", true)
        .eq("is_hourly_tracked", true)
        .order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const totalProduction = entries.reduce((sum: number, e: any) => sum + Number(e.quantity || 0), 0);
  const uniqueProcesses = new Set(entries.map((e: any) => e.process_name)).size;
  const uniqueWorkers = new Set(entries.filter((e: any) => e.worker_name).map((e: any) => e.worker_name)).size;

  const hourlyData = Array.from({ length: 24 }, (_, i) => {
    const hourEntries = entries.filter((e: any) => e.hour_slot === i);
    const qty = hourEntries.reduce((sum: number, e: any) => sum + Number(e.quantity || 0), 0);
    return { hour: HOUR_LABELS[i], quantity: qty, slot: i };
  }).filter((d) => d.slot >= 6 && d.slot <= 22);

  const processMap = new Map<string, number>();
  entries.forEach((e: any) => {
    processMap.set(e.process_name, (processMap.get(e.process_name) || 0) + Number(e.quantity || 0));
  });
  const processBreakdown = Array.from(processMap.entries()).map(([name, qty]) => ({ name, quantity: qty })).sort((a, b) => b.quantity - a.quantity);

  const workerMap = new Map<string, number>();
  entries.filter((e: any) => e.worker_name).forEach((e: any) => {
    workerMap.set(e.worker_name!, (workerMap.get(e.worker_name!) || 0) + Number(e.quantity || 0));
  });
  const workerBreakdown = Array.from(workerMap.entries()).map(([name, qty]) => ({ name, quantity: qty })).sort((a, b) => b.quantity - a.quantity);

  // Per-process hourly breakdown — show ALL hourly-tracked processes, even with zero entries
  const perProcessHourly = processes.map((proc: any) => {
    const procEntries = entries.filter((e: any) => e.process_name === proc.name);
    const data = Array.from({ length: 24 }, (_, i) => {
      const hourEntries = procEntries.filter((e: any) => e.hour_slot === i);
      const qty = hourEntries.reduce((sum: number, e: any) => sum + Number(e.quantity || 0), 0);
      return { hour: HOUR_LABELS[i], quantity: qty, slot: i };
    }).filter((d) => d.slot >= 6 && d.slot <= 22);
    const total = procEntries.reduce((sum: number, e: any) => sum + Number(e.quantity || 0), 0);
    return {
      name: proc.name,
      data,
      total,
      departmentId: proc.department_id || "__none__",
      departmentName: proc.production_departments?.name || "Unassigned",
    };
  });

  // Group processes by department
  const departmentGroups = (() => {
    const groups = new Map<string, { departmentName: string; processes: typeof perProcessHourly; total: number }>();
    perProcessHourly.forEach((p) => {
      const existing = groups.get(p.departmentId);
      if (existing) {
        existing.processes.push(p);
        existing.total += p.total;
      } else {
        groups.set(p.departmentId, { departmentName: p.departmentName, processes: [p], total: p.total });
      }
    });
    // Sort processes within each department: with-data first (desc), then empty alphabetical
    groups.forEach((g) => {
      g.processes.sort((a, b) => {
        if (a.total === 0 && b.total === 0) return a.name.localeCompare(b.name);
        if (a.total === 0) return 1;
        if (b.total === 0) return -1;
        return b.total - a.total;
      });
    });
    // Sort departments: with-data first (desc by total), then alphabetical
    return Array.from(groups.values()).sort((a, b) => {
      if (a.total === 0 && b.total === 0) return a.departmentName.localeCompare(b.departmentName);
      if (a.total === 0) return 1;
      if (b.total === 0) return -1;
      return b.total - a.total;
    });
  })();

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Hourly Production Monitoring" description="Real-time hourly production tracking dashboard" icon={Clock} iconColor="bg-violet-600 text-white" />

        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("justify-start text-left font-normal w-[240px]")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(selectedDate, "PPP")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => d && setSelectedDate(d)}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          {!isToday && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedDate(new Date())}>Today</Button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title={`${dateLabel} Total`} value={totalProduction.toLocaleString()} icon={BarChart3} iconColor="text-blue-500" />
          <MetricCard title="Active Processes" value={uniqueProcesses} icon={Factory} iconColor="text-green-500" />
          <MetricCard title="Entries" value={entries.length} icon={Clock} iconColor="text-amber-500" />
          <MetricCard title="Workers Tracked" value={uniqueWorkers} icon={Users} iconColor="text-purple-500" />
        </div>

        <Card>
          <CardHeader><CardTitle>Hourly Production Trend — {dateLabel}</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="hour" fontSize={12} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="quantity" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle>Process-wise Production</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Process</TableHead><TableHead className="text-right">Quantity</TableHead></TableRow></TableHeader>
                <TableBody>
                  {processBreakdown.length === 0 ? (
                    <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No data today</TableCell></TableRow>
                  ) : processBreakdown.map((p) => (
                    <TableRow key={p.name}><TableCell className="font-medium">{p.name}</TableCell><TableCell className="text-right">{p.quantity.toLocaleString()}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {workerBreakdown.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Worker-wise Production</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Worker</TableHead><TableHead className="text-right">Quantity</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {workerBreakdown.map((w) => (
                      <TableRow key={w.name}><TableCell className="font-medium">{w.name}</TableCell><TableCell className="text-right">{w.quantity.toLocaleString()}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>

        {departmentGroups.length > 0 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold">Hourly Trend by Process</h2>
              <p className="text-sm text-muted-foreground">Grouped by department. Red cards indicate processes with no entries logged today.</p>
            </div>
            {departmentGroups.map((dept) => (
              <div key={dept.departmentName} className="space-y-3">
                <div className="flex items-center justify-between border-b pb-2">
                  <h3 className="text-lg font-semibold text-foreground">{dept.departmentName}</h3>
                  <span className="text-sm text-muted-foreground">
                    {dept.total > 0 ? `Dept Total: ${dept.total.toLocaleString()}` : "No entries today"}
                  </span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {dept.processes.map((proc) => {
                    const isEmpty = proc.total === 0;
                    return (
                      <Card
                        key={proc.name}
                        className={isEmpty ? "border-2 border-red-500 bg-red-50 dark:bg-red-950/20" : ""}
                      >
                        <CardHeader>
                          <CardTitle className="flex items-center justify-between text-base">
                            <span className={isEmpty ? "text-red-600 dark:text-red-400" : ""}>{proc.name}</span>
                            <span
                              className={
                                isEmpty
                                  ? "text-sm font-normal text-red-600 dark:text-red-400"
                                  : "text-sm font-normal text-muted-foreground"
                              }
                            >
                              {isEmpty ? "No entries today" : `Total: ${proc.total.toLocaleString()}`}
                            </span>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="h-[220px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={proc.data}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="hour" fontSize={11} />
                                <YAxis fontSize={11} />
                                <Tooltip />
                                <Bar
                                  dataKey="quantity"
                                  fill={isEmpty ? "#ef4444" : "hsl(var(--primary))"}
                                  radius={[4, 4, 0, 0]}
                                />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ERPLayout>
  );
}
