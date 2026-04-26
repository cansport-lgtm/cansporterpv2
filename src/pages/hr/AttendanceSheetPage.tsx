import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Calendar, Printer, Users } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDate, isSunday } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface Employee {
  id: string;
  employee_code: string;
  full_name: string;
  department: { name: string } | null;
}

interface AttendanceRecord {
  id: string;
  employee_id: string;
  attendance_date: string;
  status: string;
  check_in: string | null;
  check_out: string | null;
  remarks: string | null;
}

type ViewMode = "monthly" | "daily";

const STATUS_CONFIG: Record<string, { label: string; short: string; bg: string; text: string; printBg: string }> = {
  present: { label: "Present", short: "P", bg: "bg-green-500/20", text: "text-green-600", printBg: "#dcfce7" },
  absent: { label: "Absent", short: "A", bg: "bg-red-500/10", text: "text-red-500", printBg: "#fee2e2" },
  half_day: { label: "Half Day", short: "H", bg: "bg-amber-500/20", text: "text-amber-600", printBg: "#fef3c7" },
  late: { label: "Late", short: "L", bg: "bg-orange-500/20", text: "text-orange-600", printBg: "#ffedd5" },
  on_leave: { label: "On Leave", short: "OL", bg: "bg-blue-500/20", text: "text-blue-600", printBg: "#dbeafe" },
};

const getStatusConfig = (status: string) => STATUS_CONFIG[status] || STATUS_CONFIG.absent;

const AttendanceSheetPage = () => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("monthly");

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Fetch public holidays for the current month
  const { data: publicHolidayDates = [] } = useQuery({
    queryKey: ["attendance-public-holidays", format(currentMonth, "yyyy-MM")],
    queryFn: async () => {
      const { data } = await supabase
        .from("public_holidays" as any)
        .select("holiday_date, name")
        .eq("is_active", true)
        .gte("holiday_date", format(monthStart, "yyyy-MM-dd"))
        .lte("holiday_date", format(monthEnd, "yyyy-MM-dd"));
      return (data as any[]) || [];
    },
  });

  const publicHolidaySet = useMemo(() => {
    const map = new Map<string, string>();
    publicHolidayDates.forEach((h: any) => map.set(h.holiday_date, h.name));
    return map;
  }, [publicHolidayDates]);

  const isPublicHoliday = (date: Date) => publicHolidaySet.has(format(date, "yyyy-MM-dd"));
  const getHolidayName = (date: Date) => publicHolidaySet.get(format(date, "yyyy-MM-dd")) || "Public Holiday";

  const { data: employees = [] } = useQuery({
    queryKey: ["hr-employees-attendance-sheet"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_code, full_name, department:production_departments(name)")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return (data || []) as unknown as Employee[];
    },
  });

  const { data: attendanceRecords = [] } = useQuery({
    queryKey: ["hr-attendance-sheet-records", format(currentMonth, "yyyy-MM")],
    queryFn: async () => {
      const PAGE_SIZE = 1000;
      const all: AttendanceRecord[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("attendance")
          .select("id, employee_id, attendance_date, status, check_in, check_out, remarks")
          .gte("attendance_date", format(monthStart, "yyyy-MM-dd"))
          .lte("attendance_date", format(monthEnd, "yyyy-MM-dd"))
          .order("attendance_date")
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        const page = (data ?? []) as AttendanceRecord[];
        all.push(...page);
        if (page.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return all;
    },
  });

  const attendanceMap = useMemo(() => {
    const map: Record<string, Record<string, string>> = {};
    attendanceRecords.forEach((rec) => {
      if (!map[rec.employee_id]) map[rec.employee_id] = {};
      map[rec.employee_id][rec.attendance_date] = rec.status;
    });
    return map;
  }, [attendanceRecords]);

  const getStatusForCell = (employeeId: string, dateKey: string) =>
    attendanceMap[employeeId]?.[dateKey] || null;

  const summaryStats = useMemo(() => {
    let present = 0, absent = 0, halfDay = 0, late = 0, onLeave = 0;
    employees.forEach((emp) => {
      daysInMonth.forEach((day) => {
        if (day > new Date()) return;
        if (isSunday(day) || isPublicHoliday(day)) return;
        const status = getStatusForCell(emp.id, format(day, "yyyy-MM-dd"));
        if (status === "present") present++;
        else if (status === "half_day") { halfDay++; absent += 0.5; }
        else if (status === "late") late++;
        else if (status === "on_leave") onLeave++;
        else absent++;
      });
    });
    return { present, absent, halfDay, late, onLeave };
  }, [attendanceMap, employees, daysInMonth, publicHolidaySet]);

  const dailyStats = useMemo(() => {
    const dateKey = format(selectedDate, "yyyy-MM-dd");
    const dayIsSundayOrHoliday = isSunday(selectedDate) || isPublicHoliday(selectedDate);
    let present = 0, absent = 0, halfDay = 0, late = 0, onLeave = 0;
    employees.forEach((emp) => {
      if (dayIsSundayOrHoliday) return;
      const status = getStatusForCell(emp.id, dateKey);
      if (status === "present") present++;
      else if (status === "half_day") { halfDay++; absent += 0.5; }
      else if (status === "late") late++;
      else if (status === "on_leave") onLeave++;
      else absent++;
    });
    return { present, absent, halfDay, late, onLeave };
  }, [attendanceMap, employees, selectedDate, publicHolidaySet]);

  const navigateMonth = (dir: "prev" | "next") => {
    setCurrentMonth((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + (dir === "prev" ? -1 : 1));
      return d;
    });
  };

  const navigateDate = (dir: "prev" | "next") => {
    setSelectedDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + (dir === "prev" ? -1 : 1));
      return d;
    });
  };

  const getEmployeeSummary = (empId: string) => {
    let present = 0, halfDay = 0, absent = 0, late = 0, onLeave = 0;
    daysInMonth.forEach((day) => {
      if (day > new Date()) return;
      if (isSunday(day) || isPublicHoliday(day)) return;
      const status = getStatusForCell(empId, format(day, "yyyy-MM-dd"));
      if (status === "present") present++;
      else if (status === "half_day") { halfDay++; absent += 0.5; }
      else if (status === "late") late++;
      else if (status === "on_leave") onLeave++;
      else absent++;
    });
    return { present, halfDay, absent, late, onLeave };
  };

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const styles = `<style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: Arial, sans-serif; padding: 20px; }
      .print-header { text-align: center; margin-bottom: 20px; }
      .print-header h1 { font-size: 18px; margin-bottom: 5px; }
      .print-header p { font-size: 12px; color: #666; }
      table { width: 100%; border-collapse: collapse; font-size: 10px; }
      th, td { border: 1px solid #ddd; padding: 4px; text-align: center; }
      th { background-color: #f5f5f5; font-weight: bold; }
      .employee-cell { text-align: left; min-width: 120px; }
      .employee-name { font-weight: bold; }
      .employee-code { font-size: 9px; color: #666; }
      .summary-cell { font-size: 9px; }
      .legend { margin-top: 15px; font-size: 10px; display: flex; gap: 20px; justify-content: center; flex-wrap: wrap; }
      .legend span { display: flex; align-items: center; gap: 5px; }
      .legend-box { width: 12px; height: 12px; display: inline-block; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style>`;

    if (viewMode === "daily") {
      const dateKey = format(selectedDate, "yyyy-MM-dd");
      const rows = employees.map((emp) => {
        const status = getStatusForCell(emp.id, dateKey);
        const cfg = getStatusConfig(status || "absent");
        return `<tr>
          <td class="employee-cell"><div class="employee-name">${emp.full_name}</div><div class="employee-code">${emp.employee_code}</div></td>
          <td>${emp.department?.name || "-"}</td>
          <td style="background:${cfg.printBg}">${cfg.label}</td>
        </tr>`;
      }).join("");

      printWindow.document.write(`<!DOCTYPE html><html><head><title>Daily Attendance - ${format(selectedDate, "dd MMM yyyy")}</title>${styles}</head><body>
        <div class="print-header"><h1>Daily Attendance Sheet</h1><p>${format(selectedDate, "EEEE, dd MMMM yyyy")} | Total Employees: ${employees.length}</p></div>
        <table><thead><tr><th class="employee-cell">Employee</th><th>Department</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="legend">
          ${Object.entries(STATUS_CONFIG).map(([, c]) => `<span><span class="legend-box" style="background:${c.printBg}"></span>${c.label}: ${dailyStats[c.short === "P" ? "present" : c.short === "A" ? "absent" : c.short === "H" ? "halfDay" : c.short === "L" ? "late" : "onLeave"] ?? 0}</span>`).join("")}
        </div></body></html>`);
    } else {
      const dayHeaders = daysInMonth.map((d) => `<th>${format(d, "EEE")}<br/>${getDate(d)}</th>`).join("");
      const rows = employees.map((emp) => {
        const summary = getEmployeeSummary(emp.id);
        const cells = daysInMonth.map((day) => {
          if (day > new Date()) return "<td>-</td>";
          const status = getStatusForCell(emp.id, format(day, "yyyy-MM-dd"));
          const cfg = getStatusConfig(status || "absent");
          return `<td style="background:${cfg.printBg}">${cfg.short}</td>`;
        }).join("");
        return `<tr><td class="employee-cell"><div class="employee-name">${emp.full_name}</div><div class="employee-code">${emp.employee_code}</div></td>${cells}<td class="summary-cell">${summary.present}P/${summary.halfDay}H/${summary.absent}A/${summary.late}L/${summary.onLeave}OL</td></tr>`;
      }).join("");

      printWindow.document.write(`<!DOCTYPE html><html><head><title>Attendance Sheet - ${format(currentMonth, "MMMM yyyy")}</title>${styles}</head><body>
        <div class="print-header"><h1>Monthly Attendance Sheet</h1><p>${format(currentMonth, "MMMM yyyy")} | Total Employees: ${employees.length}</p></div>
        <table><thead><tr><th class="employee-cell">Employee</th>${dayHeaders}<th>Summary</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="legend">
          ${Object.entries(STATUS_CONFIG).map(([, c]) => `<span><span class="legend-box" style="background:${c.printBg}"></span>${c.short} = ${c.label}</span>`).join("")}
        </div></body></html>`);
    }

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
  };

  const renderAttendanceCell = (employeeId: string, date: Date) => {
    const isFuture = date > new Date();
    const isToday = format(date, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
    if (isFuture) return <div className="w-8 h-8 flex items-center justify-center text-muted-foreground/30">-</div>;

    // Show public holiday marker (same style as Sunday)
    if (isPublicHoliday(date)) {
      return (
        <div
          className={cn("w-8 h-8 flex items-center justify-center rounded text-xs font-medium bg-purple-500/20 text-purple-600", isToday && "ring-2 ring-primary")}
          title={getHolidayName(date)}
        >
          PH
        </div>
      );
    }

    // Show Sunday marker
    if (isSunday(date)) {
      return (
        <div
          className={cn("w-8 h-8 flex items-center justify-center rounded text-xs font-medium bg-gray-500/20 text-gray-500", isToday && "ring-2 ring-primary")}
          title="Sunday"
        >
          S
        </div>
      );
    }

    const status = getStatusForCell(employeeId, format(date, "yyyy-MM-dd"));
    const cfg = getStatusConfig(status || "absent");

    return (
      <div
        className={cn("w-8 h-8 flex items-center justify-center rounded text-xs font-medium", cfg.bg, cfg.text, isToday && "ring-2 ring-primary")}
        title={cfg.label}
      >
        {cfg.short}
      </div>
    );
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Attendance Sheet"
        description="Monthly & daily attendance overview for all employees"
        icon={Users}
        iconColor="bg-purple-500/10 text-purple-500"
        action={{ label: "Print", onClick: handlePrint, icon: Printer }}
      />

      <div className="flex items-center justify-between mb-6">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
          <TabsList>
            <TabsTrigger value="monthly">Monthly View</TabsTrigger>
            <TabsTrigger value="daily">Daily View</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex gap-4 flex-wrap">
          {Object.entries(STATUS_CONFIG).map(([key, c]) => (
            <div key={key} className="flex items-center gap-2">
              <div className={cn("w-4 h-4 rounded", c.bg)} />
              <span className="text-sm">{c.short} = {c.label}</span>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-gray-500/20" />
            <span className="text-sm">S = Sunday</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-purple-500/20" />
            <span className="text-sm">PH = Public Holiday</span>
          </div>
        </div>
      </div>

      {viewMode === "monthly" ? (
        <>
          <div className="flex items-center gap-4 mb-6">
            <Button variant="outline" size="icon" onClick={() => navigateMonth("prev")}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <Select value={String(currentMonth.getMonth())} onValueChange={(v) => { const d = new Date(currentMonth); d.setMonth(Number(v)); setCurrentMonth(d); }}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>{format(new Date(2000, i), "MMMM")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(currentMonth.getFullYear())} onValueChange={(v) => { const d = new Date(currentMonth); d.setFullYear(Number(v)); setCurrentMonth(d); }}>
                <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 7 }, (_, i) => {
                    const year = new Date().getFullYear() - 3 + i;
                    return <SelectItem key={year} value={String(year)}>{year}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="icon" onClick={() => navigateMonth("next")}><ChevronRight className="h-4 w-4" /></Button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Employees</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{employees.length}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Present</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-green-600">{summaryStats.present}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Absent</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-red-500">{summaryStats.absent}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Half Day</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-amber-600">{summaryStats.halfDay}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">On Leave</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-blue-600">{summaryStats.onLeave}</div></CardContent></Card>
          </div>

          <Card>
            <CardContent className="p-0 overflow-hidden">
              <div className="w-full overflow-x-auto">
                <div className="min-w-max">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="sticky left-0 z-10 bg-card px-4 py-3 text-left font-medium min-w-[180px]">Employee</th>
                        {daysInMonth.map((day) => (
                          <th key={day.toISOString()} className={cn("px-1 py-3 text-center font-medium min-w-[40px]", isSunday(day) && "bg-gray-100 dark:bg-gray-800", isPublicHoliday(day) && "bg-purple-100 dark:bg-purple-900/30")}>
                            <div className="text-xs text-muted-foreground">{format(day, "EEE")}</div>
                            <div className={cn(isPublicHoliday(day) && "text-purple-600 font-bold")}>{getDate(day)}</div>
                          </th>
                        ))}
                        <th className="px-4 py-3 text-center font-medium min-w-[100px]">Summary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((emp) => {
                        const summary = getEmployeeSummary(emp.id);
                        return (
                          <tr key={emp.id} className="border-b hover:bg-muted/50">
                            <td className="sticky left-0 z-10 bg-card px-4 py-2">
                              <div className="font-medium text-sm">{emp.full_name}</div>
                              <div className="text-xs text-muted-foreground">{emp.employee_code}</div>
                            </td>
                            {daysInMonth.map((day) => (
                              <td key={day.toISOString()} className="px-1 py-2 text-center">
                                {renderAttendanceCell(emp.id, day)}
                              </td>
                            ))}
                            <td className="px-4 py-2 text-center">
                              <div className="text-xs space-y-0.5">
                                <span className="text-green-600">{summary.present}P</span>{" / "}
                                <span className="text-amber-600">{summary.halfDay}H</span>{" / "}
                                <span className="text-red-500">{summary.absent}A</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {employees.length === 0 && (
                        <tr><td colSpan={daysInMonth.length + 2} className="text-center py-8 text-muted-foreground">No active employees found</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <div className="flex items-center gap-4 mb-6">
            <Button variant="outline" size="icon" onClick={() => navigateDate("prev")}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <span className="text-lg font-semibold">{format(selectedDate, "EEEE, dd MMMM yyyy")}</span>
            </div>
            <Button variant="outline" size="icon" onClick={() => navigateDate("next")}><ChevronRight className="h-4 w-4" /></Button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{employees.length}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Present</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-green-600">{dailyStats.present}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Absent</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-red-500">{dailyStats.absent}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Half Day</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-amber-600">{dailyStats.halfDay}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">On Leave</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-blue-600">{dailyStats.onLeave}</div></CardContent></Card>
          </div>

          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-4 py-3 text-left font-medium">Employee</th>
                    <th className="px-4 py-3 text-left font-medium">Department</th>
                    <th className="px-4 py-3 text-center font-medium">Status</th>
                    <th className="px-4 py-3 text-center font-medium">Check In</th>
                    <th className="px-4 py-3 text-center font-medium">Check Out</th>
                    <th className="px-4 py-3 text-left font-medium">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => {
                    const dateKey = format(selectedDate, "yyyy-MM-dd");
                    const record = attendanceRecords.find((r) => r.employee_id === emp.id && r.attendance_date === dateKey);
                    const status = record?.status || "absent";
                    const cfg = getStatusConfig(status);
                    return (
                      <tr key={emp.id} className="border-b hover:bg-muted/50">
                        <td className="px-4 py-3">
                          <div className="font-medium">{emp.full_name}</div>
                          <div className="text-xs text-muted-foreground">{emp.employee_code}</div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{emp.department?.name || "-"}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium", cfg.bg, cfg.text)}>
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-muted-foreground">{record?.check_in || "-"}</td>
                        <td className="px-4 py-3 text-center text-muted-foreground">{record?.check_out || "-"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{record?.remarks || "-"}</td>
                      </tr>
                    );
                  })}
                  {employees.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No active employees found</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </ERPLayout>
  );
};

export default AttendanceSheetPage;
