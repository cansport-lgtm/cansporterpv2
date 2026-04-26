import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { Save, TrendingUp, TrendingDown, Minus, CalendarIcon } from "lucide-react";
import { format, endOfMonth } from "date-fns";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function LabourMPHManagementPage() {
  const queryClient = useQueryClient();
  const now = new Date();
  const [selectedDate, setSelectedDate] = useState<Date>(now);
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [reasonValues, setReasonValues] = useState<Record<string, string>>({});
  const [actionValues, setActionValues] = useState<Record<string, string>>({});

  const dateStr = format(selectedDate, "yyyy-MM-dd");

  // Fetch departments
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data } = await supabase
        .from("production_departments")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  // Fetch MPH calculating numbers
  const { data: mphNumbers = [] } = useQuery({
    queryKey: ["mph-calculating-numbers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("mph_calculating_numbers")
        .select("department_id, sub_department_id, mph_number")
        .eq("is_active", true);
      return data || [];
    },
  });

  // Fetch production entries for selected date (daily)
  const { data: dailyProduction = [] } = useQuery({
    queryKey: ["production-entries-daily-mph", dateStr],
    queryFn: async () => {
      const { data } = await supabase
        .from("production_entries")
        .select("department_id, sub_department_id, quantity_produced")
        .eq("entry_date", dateStr);
      return data || [];
    },
  });

  // Fetch existing reason/action data for the date
  const { data: authorizedData = [] } = useQuery({
    queryKey: ["labour-mph-authorized-daily", dateStr],
    queryFn: async () => {
      const { data } = await supabase
        .from("labour_mph_authorized" as any)
        .select("*")
        .eq("entry_date", dateStr);
      return (data || []) as any[];
    },
  });

  // Fetch used MPH for selected date
  const { data: usedMphDaily = [] } = useQuery({
    queryKey: ["labour-mph-used-daily", dateStr],
    queryFn: async () => {
      const { data } = await supabase
        .from("labour_productivity_targets")
        .select("department_id, mph")
        .eq("target_date", dateStr);
      return data || [];
    },
  });

  // Monthly analysis queries
  const monthStart = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-01`;
  const monthEndDate = endOfMonth(new Date(selectedYear, selectedMonth - 1));
  const monthEnd = format(monthEndDate, "yyyy-MM-dd");

  const { data: monthlyProduction = [] } = useQuery({
    queryKey: ["production-entries-monthly-mph", selectedMonth, selectedYear],
    queryFn: async () => {
      const { data } = await supabase
        .from("production_entries")
        .select("department_id, sub_department_id, quantity_produced, entry_date")
        .gte("entry_date", monthStart)
        .lte("entry_date", monthEnd);
      return data || [];
    },
  });

  const { data: monthlyUsed = [] } = useQuery({
    queryKey: ["labour-mph-used-monthly", selectedMonth, selectedYear],
    queryFn: async () => {
      const { data } = await supabase
        .from("labour_productivity_targets")
        .select("department_id, mph, target_date")
        .gte("target_date", monthStart)
        .lte("target_date", monthEnd);
      return data || [];
    },
  });

  // Helper: compute authorized MPH from production entries + mph numbers
  const computeAuthorizedByDept = (
    prodEntries: { department_id: string | null; sub_department_id: string | null; quantity_produced: number }[]
  ) => {
    const map: Record<string, number> = {};
    prodEntries.forEach((entry) => {
      if (!entry.department_id) return;
      const mphRow = mphNumbers.find(
        (m) =>
          m.department_id === entry.department_id &&
          (m.sub_department_id || null) === (entry.sub_department_id || null)
      );
      if (!mphRow) return;
      const mph = Number(entry.quantity_produced || 0) * Number(mphRow.mph_number || 0);
      map[entry.department_id] = (map[entry.department_id] || 0) + mph;
    });
    return map;
  };

  // Daily tab calculations
  const authorizedByDeptComputed = useMemo(
    () => computeAuthorizedByDept(dailyProduction as any),
    [dailyProduction, mphNumbers]
  );

  const usedByDept = useMemo(() => {
    const map: Record<string, number> = {};
    usedMphDaily.forEach((e) => {
      if (e.department_id) map[e.department_id] = (map[e.department_id] || 0) + Number(e.mph || 0);
    });
    return map;
  }, [usedMphDaily]);

  const authorizedReasonAction = useMemo(() => {
    const map: Record<string, { id: string; reason_for_loss: string; action_taken: string }> = {};
    authorizedData.forEach((item: any) => {
      map[item.department_id] = { id: item.id, reason_for_loss: item.reason_for_loss || "", action_taken: item.action_taken || "" };
    });
    return map;
  }, [authorizedData]);

  // Save reason/action only
  const saveMutation = useMutation({
    mutationFn: async (entries: { department_id: string; reason_for_loss: string; action_taken: string }[]) => {
      for (const entry of entries) {
        const existing = authorizedReasonAction[entry.department_id];
        if (existing) {
          await supabase
            .from("labour_mph_authorized" as any)
            .update({ reason_for_loss: entry.reason_for_loss || null, action_taken: entry.action_taken || null } as any)
            .eq("id", existing.id);
        } else {
          await supabase
            .from("labour_mph_authorized" as any)
            .insert({
              department_id: entry.department_id,
              entry_date: dateStr,
              authorized_mph: 0,
              reason_for_loss: entry.reason_for_loss || null,
              action_taken: entry.action_taken || null,
            } as any);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labour-mph-authorized-daily"] });
      setReasonValues({});
      setActionValues({});
      toast.success("Saved for " + format(selectedDate, "dd MMM yyyy"));
    },
    onError: () => toast.error("Failed to save"),
  });

  const handleSave = () => {
    const changedDepts = new Set([...Object.keys(reasonValues), ...Object.keys(actionValues)]);
    const entries = Array.from(changedDepts)
      .map((deptId) => {
        const reasonVal = reasonValues[deptId] !== undefined ? reasonValues[deptId] : (authorizedReasonAction[deptId]?.reason_for_loss ?? "");
        const actionVal = actionValues[deptId] !== undefined ? actionValues[deptId] : (authorizedReasonAction[deptId]?.action_taken ?? "");
        return { department_id: deptId, reason_for_loss: reasonVal, action_taken: actionVal };
      })
      .filter((e) => e.reason_for_loss || e.action_taken);
    if (entries.length === 0) { toast.info("No changes to save"); return; }
    saveMutation.mutate(entries);
  };

  // Daily table data
  const dailyTableData = useMemo(() => {
    return departments.map((dept) => {
      const authorized = authorizedByDeptComputed[dept.id] || 0;
      const used = usedByDept[dept.id] || 0;
      const net = authorized - used;
      return { ...dept, authorized, used, net };
    });
  }, [departments, authorizedByDeptComputed, usedByDept]);

  const dailyTotals = useMemo(() => {
    return dailyTableData.reduce(
      (acc, r) => ({ authorized: acc.authorized + r.authorized, used: acc.used + r.used, net: acc.net + r.net }),
      { authorized: 0, used: 0, net: 0 }
    );
  }, [dailyTableData]);

  // Monthly analysis data
  const monthlyAnalysis = useMemo(() => {
    const authMap = computeAuthorizedByDept(monthlyProduction as any);
    const usedMap: Record<string, number> = {};
    monthlyUsed.forEach((item) => {
      if (item.department_id) usedMap[item.department_id] = (usedMap[item.department_id] || 0) + Number(item.mph || 0);
    });
    // Count unique production days per dept
    const daysMap: Record<string, Set<string>> = {};
    (monthlyProduction as any[]).forEach((item: any) => {
      if (!item.department_id) return;
      if (!daysMap[item.department_id]) daysMap[item.department_id] = new Set();
      daysMap[item.department_id].add(item.entry_date);
    });

    return departments.map((dept) => {
      const authorized = authMap[dept.id] || 0;
      const used = usedMap[dept.id] || 0;
      const net = authorized - used;
      const entryDays = daysMap[dept.id]?.size || 0;
      return { ...dept, authorized, used, net, entryDays };
    });
  }, [departments, monthlyProduction, monthlyUsed, mphNumbers]);

  const monthlyTotals = useMemo(() => {
    return monthlyAnalysis.reduce(
      (acc, r) => ({ authorized: acc.authorized + r.authorized, used: acc.used + r.used, net: acc.net + r.net }),
      { authorized: 0, used: 0, net: 0 }
    );
  }, [monthlyAnalysis]);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <ERPLayout>
      <div className="space-y-4 p-4 md:p-6">
        <PageHeader title="MPH Management" description="Auto-calculated from production data" />

        <Tabs defaultValue="daily">
          <TabsList>
            <TabsTrigger value="daily">Daily Entry</TabsTrigger>
            <TabsTrigger value="monthly">Monthly Analysis</TabsTrigger>
          </TabsList>

          {/* DAILY ENTRY TAB */}
          <TabsContent value="daily" className="space-y-4 mt-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Date</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[160px] justify-start">
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {format(selectedDate, "dd MMM yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={selectedDate} onSelect={(d) => { if (d) { setSelectedDate(d); setReasonValues({}); setActionValues({}); }}} />
                  </PopoverContent>
                </Popover>
              </div>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                <Save className="h-4 w-4 mr-2" />Save
              </Button>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-3 gap-3">
              <Card><CardContent className="pt-3 pb-2">
                <p className="text-[10px] text-muted-foreground">Authorized</p>
                <p className="text-lg font-bold">{dailyTotals.authorized.toFixed(1)}</p>
              </CardContent></Card>
              <Card><CardContent className="pt-3 pb-2">
                <p className="text-[10px] text-muted-foreground">Used</p>
                <p className="text-lg font-bold">{dailyTotals.used.toFixed(1)}</p>
              </CardContent></Card>
              <Card><CardContent className="pt-3 pb-2">
                <p className="text-[10px] text-muted-foreground">Net</p>
                <p className={`text-lg font-bold ${dailyTotals.net > 0 ? "text-green-600" : dailyTotals.net < 0 ? "text-red-600" : ""}`}>
                  {dailyTotals.net > 0 ? "+" : ""}{dailyTotals.net.toFixed(1)}
                </p>
              </CardContent></Card>
            </div>

            {/* Daily Table */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-xs font-semibold">Department</TableHead>
                        <TableHead className="text-xs font-semibold text-right w-[100px]">Auth MPH</TableHead>
                        <TableHead className="text-xs font-semibold text-right w-[90px]">Used</TableHead>
                        <TableHead className="text-xs font-semibold text-right w-[100px]">Net</TableHead>
                        <TableHead className="text-xs font-semibold text-center w-[70px]">Status</TableHead>
                        <TableHead className="text-xs font-semibold w-[200px]">Reason for Loss</TableHead>
                        <TableHead className="text-xs font-semibold w-[200px]">Action Taken</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dailyTableData.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium text-sm">{row.name}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{row.authorized.toFixed(1)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{row.used.toFixed(1)}</TableCell>
                          <TableCell className={`text-right text-sm font-bold ${row.net > 0 ? "text-green-600" : row.net < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                            {row.net > 0 ? "+" : ""}{row.net.toFixed(1)}
                          </TableCell>
                          <TableCell className="text-center">
                            {row.authorized === 0 ? (
                              <Badge variant="outline" className="text-[10px] px-1"><Minus className="h-3 w-3" /></Badge>
                            ) : row.net >= 0 ? (
                              <Badge className="bg-green-100 text-green-700 text-[10px] px-1">
                                <TrendingUp className="h-3 w-3" />
                              </Badge>
                            ) : (
                              <Badge className="bg-red-100 text-red-700 text-[10px] px-1">
                                <TrendingDown className="h-3 w-3" />
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {row.net < 0 ? (
                              <Textarea
                                className="text-sm w-full min-h-[60px] resize-y"
                                value={reasonValues[row.id] !== undefined ? reasonValues[row.id] : (authorizedReasonAction[row.id]?.reason_for_loss ?? "")}
                                onChange={(e) => setReasonValues((prev) => ({ ...prev, [row.id]: e.target.value }))}
                                placeholder="Enter reason for loss..."
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {row.net < 0 ? (
                              <Textarea
                                className="text-sm w-full min-h-[60px] resize-y"
                                value={actionValues[row.id] !== undefined ? actionValues[row.id] : (authorizedReasonAction[row.id]?.action_taken ?? "")}
                                onChange={(e) => setActionValues((prev) => ({ ...prev, [row.id]: e.target.value }))}
                                placeholder="Enter action taken..."
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell>Total</TableCell>
                        <TableCell className="text-right text-sm">{dailyTotals.authorized.toFixed(1)}</TableCell>
                        <TableCell className="text-right text-sm">{dailyTotals.used.toFixed(1)}</TableCell>
                        <TableCell className={`text-right text-sm ${dailyTotals.net > 0 ? "text-green-600" : dailyTotals.net < 0 ? "text-red-600" : ""}`}>
                          {dailyTotals.net > 0 ? "+" : ""}{dailyTotals.net.toFixed(1)}
                        </TableCell>
                        <TableCell />
                        <TableCell />
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* MONTHLY ANALYSIS TAB */}
          <TabsContent value="monthly" className="space-y-4 mt-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Month</label>
                <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Year</label>
                <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                  <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {years.map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Monthly Summary */}
            <div className="grid grid-cols-3 gap-3">
              <Card><CardContent className="pt-3 pb-2">
                <p className="text-[10px] text-muted-foreground">Total Authorized</p>
                <p className="text-lg font-bold">{monthlyTotals.authorized.toFixed(1)}</p>
              </CardContent></Card>
              <Card><CardContent className="pt-3 pb-2">
                <p className="text-[10px] text-muted-foreground">Total Used</p>
                <p className="text-lg font-bold">{monthlyTotals.used.toFixed(1)}</p>
              </CardContent></Card>
              <Card><CardContent className="pt-3 pb-2">
                <p className="text-[10px] text-muted-foreground">Net MPH</p>
                <p className={`text-lg font-bold ${monthlyTotals.net > 0 ? "text-green-600" : monthlyTotals.net < 0 ? "text-red-600" : ""}`}>
                  {monthlyTotals.net > 0 ? "+" : ""}{monthlyTotals.net.toFixed(1)}
                </p>
              </CardContent></Card>
            </div>

            {/* Monthly Table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{MONTHS[selectedMonth - 1]} {selectedYear} — Monthly MPH Analysis</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-xs font-semibold">Department</TableHead>
                        <TableHead className="text-xs font-semibold text-right w-[70px]">Days</TableHead>
                        <TableHead className="text-xs font-semibold text-right w-[90px]">Auth MPH</TableHead>
                        <TableHead className="text-xs font-semibold text-right w-[90px]">Used MPH</TableHead>
                        <TableHead className="text-xs font-semibold text-right w-[90px]">Net</TableHead>
                        <TableHead className="text-xs font-semibold text-center w-[70px]">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {monthlyAnalysis.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium text-sm">{row.name}</TableCell>
                          <TableCell className="text-right text-sm">{row.entryDays}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{row.authorized.toFixed(1)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{row.used.toFixed(1)}</TableCell>
                          <TableCell className={`text-right text-sm font-bold ${row.net > 0 ? "text-green-600" : row.net < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                            {row.net > 0 ? "+" : ""}{row.net.toFixed(1)}
                          </TableCell>
                          <TableCell className="text-center">
                            {row.authorized === 0 ? (
                              <Badge variant="outline" className="text-[10px] px-1"><Minus className="h-3 w-3" /></Badge>
                            ) : row.net >= 0 ? (
                              <Badge className="bg-green-100 text-green-700 text-[10px] px-1">Saved</Badge>
                            ) : (
                              <Badge className="bg-red-100 text-red-700 text-[10px] px-1">Loss</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell>Total</TableCell>
                        <TableCell />
                        <TableCell className="text-right text-sm">{monthlyTotals.authorized.toFixed(1)}</TableCell>
                        <TableCell className="text-right text-sm">{monthlyTotals.used.toFixed(1)}</TableCell>
                        <TableCell className={`text-right text-sm ${monthlyTotals.net > 0 ? "text-green-600" : monthlyTotals.net < 0 ? "text-red-600" : ""}`}>
                          {monthlyTotals.net > 0 ? "+" : ""}{monthlyTotals.net.toFixed(1)}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ERPLayout>
  );
}
