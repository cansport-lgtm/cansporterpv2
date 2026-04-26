import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from "recharts";
import { BarChart3 } from "lucide-react";
import { format, subDays } from "date-fns";

export default function HourlyProductionReportsPage() {
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 7), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [selectedProcess, setSelectedProcess] = useState("all");

  const { data: processes = [] } = useQuery({
    queryKey: ["qa-processes-hourly"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("qa_processes").select("id, name, code, department_id").eq("is_active", true).eq("is_hourly_tracked", true).order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["hourly-production-report", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hourly_production_entries")
        .select("*")
        .gte("entry_date", fromDate)
        .lte("entry_date", toDate)
        .order("entry_date");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const filtered = selectedProcess === "all" ? entries : entries.filter((e: any) => e.process_name === selectedProcess);

  const dailyMap = new Map<string, number>();
  filtered.forEach((e: any) => { dailyMap.set(e.entry_date, (dailyMap.get(e.entry_date) || 0) + Number(e.quantity || 0)); });
  const dailyTrend = Array.from(dailyMap.entries()).map(([date, qty]) => ({ date: format(new Date(date + "T00:00:00"), "dd MMM"), quantity: qty }));

  const processCompare = new Map<string, number>();
  entries.forEach((e: any) => { processCompare.set(e.process_name, (processCompare.get(e.process_name) || 0) + Number(e.quantity || 0)); });
  const processData = Array.from(processCompare.entries()).map(([name, qty]) => {
    return { name, actual: qty, target: null };
  }).sort((a, b) => b.actual - a.actual);

  const workerMap = new Map<string, number>();
  filtered.filter((e: any) => e.worker_name).forEach((e: any) => { workerMap.set(e.worker_name!, (workerMap.get(e.worker_name!) || 0) + Number(e.quantity || 0)); });
  const workerData = Array.from(workerMap.entries()).map(([name, qty]) => ({ name, quantity: qty })).sort((a, b) => b.quantity - a.quantity);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Production Reports" description="Analyze hourly production trends and performance" icon={BarChart3} iconColor="bg-violet-600 text-white" />

        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div><Label>From Date</Label><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
              <div><Label>To Date</Label><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
              <div>
                <Label>Process</Label>
                <Select value={selectedProcess} onValueChange={setSelectedProcess}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Processes</SelectItem>
                    {processes.map((p: any) => (<SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Daily Production Trend</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={12} />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="quantity" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Process Comparison — Target vs Actual</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={processData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="actual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="target" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {workerData.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Worker Productivity</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Worker</TableHead><TableHead className="text-right">Total Quantity</TableHead></TableRow></TableHeader>
                <TableBody>
                  {workerData.map((w, i) => (
                    <TableRow key={w.name}><TableCell>{i + 1}</TableCell><TableCell className="font-medium">{w.name}</TableCell><TableCell className="text-right">{w.quantity.toLocaleString()}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </ERPLayout>
  );
}
