import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Calendar, Printer } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDate, getDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface LabourEmployee {
  id: string;
  employee_code: string;
  full_name: string;
}

interface ProductivityEntry {
  id: string;
  employee_id: string;
  target_date: string;
  work_type: string;
  mph: number;
  check_in: string | null;
  check_out: string | null;
}

const formatTime = (t: string | null | undefined): string => {
  if (!t) return "";
  const m = String(t).match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
};

type ViewMode = "monthly" | "daily";

const LabourAttendancePage = () => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("monthly");

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Fetch all active labour employees
  const { data: employees = [] } = useQuery({
    queryKey: ["labour-employees-attendance"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labour_employees")
        .select("id, employee_code, full_name")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data as LabourEmployee[];
    },
  });

  // Fetch public holidays for the current year
  const { data: publicHolidays = [] } = useQuery({
    queryKey: ["labour-public-holidays", format(currentMonth, "yyyy")],
    queryFn: async () => {
      const year = currentMonth.getFullYear();
      const { data, error } = await (supabase as any)
        .from("public_holidays")
        .select("holiday_date, name")
        .eq("is_active", true)
        .gte("holiday_date", `${year}-01-01`)
        .lte("holiday_date", `${year}-12-31`);
      if (error) throw error;
      return (data || []) as { holiday_date: string; name: string }[];
    },
  });

  const publicHolidayMap = useMemo(() => {
    const map: Record<string, string> = {};
    publicHolidays.forEach((ph) => {
      map[ph.holiday_date] = ph.name;
    });
    return map;
  }, [publicHolidays]);

  // Fetch productivity entries for the month
  const { data: entries = [] } = useQuery({
    queryKey: ["labour-attendance-entries", format(currentMonth, "yyyy-MM")],
    queryFn: async () => {
      const PAGE_SIZE = 1000;
      const all: ProductivityEntry[] = [];
      let from = 0;
      while (true) {
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await supabase
          .from("labour_productivity_targets")
          .select("id, employee_id, target_date, work_type, mph, check_in, check_out")
          .gte("target_date", format(monthStart, "yyyy-MM-dd"))
          .lte("target_date", format(monthEnd, "yyyy-MM-dd"))
          .order("target_date", { ascending: true })
          .order("employee_id", { ascending: true })
          .range(from, to);
        if (error) throw error;
        const page = (data ?? []) as ProductivityEntry[];
        all.push(...page);
        if (page.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return all;
    },
  });

  // Create a map of employee attendance by date
  const attendanceMap = useMemo(() => {
    const map: Record<string, Record<string, { workType: string; totalMph: number; checkIn: string | null; checkOut: string | null }>> = {};
    entries.forEach((entry) => {
      if (!map[entry.employee_id]) map[entry.employee_id] = {};
      const dateKey = entry.target_date;
      if (!map[entry.employee_id][dateKey]) {
        map[entry.employee_id][dateKey] = { workType: entry.work_type, totalMph: 0, checkIn: null, checkOut: null };
      }
      const cell = map[entry.employee_id][dateKey];
      cell.totalMph += Number(entry.mph) || 0;
      // Earliest check_in, latest check_out across rows for same day
      const ci = formatTime(entry.check_in);
      const co = formatTime(entry.check_out);
      if (ci && (!cell.checkIn || ci < cell.checkIn)) cell.checkIn = ci;
      if (co && (!cell.checkOut || co > cell.checkOut)) cell.checkOut = co;
      if (cell.totalMph >= 12) {
        cell.workType = "Full Day";
      } else if (cell.totalMph >= 6) {
        cell.workType = "Half Day";
      }
    });
    return map;
  }, [entries]);

  // Helper to check if a date is a public holiday
  const isPublicHoliday = (dateKey: string) => !!publicHolidayMap[dateKey];
  const isSunday = (date: Date) => getDay(date) === 0;

  // Calculate summary statistics for monthly view
  const summaryStats = useMemo(() => {
    let totalPresent = 0;
    let totalHalfDays = 0;
    let totalAbsent = 0;
    let totalPH = 0;

    employees.forEach((emp) => {
      daysInMonth.forEach((day) => {
        if (day > new Date()) return;
        const dateKey = format(day, "yyyy-MM-dd");

        if (isPublicHoliday(dateKey)) {
          totalPH++;
          return;
        }
        if (isSunday(day)) return;

        const attendance = attendanceMap[emp.id]?.[dateKey];
        if (attendance) {
          if (attendance.totalMph >= 12) totalPresent++;
          else totalHalfDays++;
        } else {
          totalAbsent++;
        }
      });
    });

    return { totalPresent, totalHalfDays, totalAbsent, totalPH };
  }, [attendanceMap, employees, daysInMonth, publicHolidayMap]);

  // Calculate daily stats
  const dailyStats = useMemo(() => {
    const dateKey = format(selectedDate, "yyyy-MM-dd");
    const isPH = isPublicHoliday(dateKey);
    let present = 0;
    let halfDay = 0;
    let absent = 0;

    employees.forEach((emp) => {
      if (isPH) return;
      const attendance = attendanceMap[emp.id]?.[dateKey];
      if (attendance) {
        if (attendance.totalMph >= 12) present++;
        else halfDay++;
      } else {
        absent++;
      }
    });

    return { present, halfDay, absent, isPH };
  }, [attendanceMap, employees, selectedDate, publicHolidayMap]);

  const navigateMonth = (direction: "prev" | "next") => {
    setCurrentMonth((prev) => {
      const newDate = new Date(prev);
      if (direction === "prev") newDate.setMonth(newDate.getMonth() - 1);
      else newDate.setMonth(newDate.getMonth() + 1);
      return newDate;
    });
  };

  const navigateDate = (direction: "prev" | "next") => {
    setSelectedDate((prev) => {
      const newDate = new Date(prev);
      if (direction === "prev") newDate.setDate(newDate.getDate() - 1);
      else newDate.setDate(newDate.getDate() + 1);
      return newDate;
    });
  };

  // Calculate employee summary for monthly view
  const getEmployeeSummary = (employeeId: string) => {
    let present = 0;
    let halfDays = 0;
    let absent = 0;
    let ph = 0;

    daysInMonth.forEach((day) => {
      if (day > new Date()) return;
      const dateKey = format(day, "yyyy-MM-dd");

      if (isPublicHoliday(dateKey)) {
        ph++;
        return;
      }
      if (isSunday(day)) return;

      const attendance = attendanceMap[employeeId]?.[dateKey];
      if (attendance) {
        if (attendance.totalMph >= 12) present++;
        else halfDays++;
      } else {
        absent++;
      }
    });

    return { present, halfDays, absent, ph };
  };

  // Get employee attendance for selected date (daily view)
  const getDailyAttendance = (employeeId: string) => {
    const dateKey = format(selectedDate, "yyyy-MM-dd");
    return attendanceMap[employeeId]?.[dateKey];
  };

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const styles = `
      <style>
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
        .present { background-color: #dcfce7; color: #16a34a; }
        .half-day { background-color: #fef3c7; color: #d97706; }
        .absent { background-color: #fee2e2; color: #dc2626; }
        .public-holiday { background-color: #f3e8ff; color: #7c3aed; }
        .sunday { background-color: #f1f5f9; color: #64748b; }
        .summary-cell { font-size: 9px; }
        .legend { margin-top: 15px; font-size: 10px; display: flex; gap: 20px; justify-content: center; flex-wrap: wrap; }
        .legend span { display: flex; align-items: center; gap: 5px; }
        .legend-box { width: 12px; height: 12px; display: inline-block; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      </style>
    `;

    if (viewMode === "daily") {
      const dateKey = format(selectedDate, "yyyy-MM-dd");
      const isPH = isPublicHoliday(dateKey);
      const tableRows = employees.map((employee) => {
        if (isPH) {
          return `
            <tr>
              <td class="employee-cell">
                <div class="employee-name">${employee.full_name}</div>
                <div class="employee-code">${employee.employee_code}</div>
              </td>
              <td class="public-holiday">Public Holiday</td>
              <td>-</td>
            </tr>
          `;
        }
        const attendance = attendanceMap[employee.id]?.[dateKey];
        let statusCell = '<td class="absent">Absent</td>';
        let mphCell = '<td>0</td>';
        if (attendance) {
          const isFullDay = attendance.totalMph >= 12;
          statusCell = isFullDay
            ? '<td class="present">Present (Full Day)</td>'
            : '<td class="half-day">Present (Half Day)</td>';
          mphCell = `<td>${attendance.totalMph}</td>`;
        }
        return `
          <tr>
            <td class="employee-cell">
              <div class="employee-name">${employee.full_name}</div>
              <div class="employee-code">${employee.employee_code}</div>
            </td>
            ${statusCell}
            ${mphCell}
          </tr>
        `;
      }).join("");

      printWindow.document.write(`
        <!DOCTYPE html><html><head>
          <title>Daily Attendance - ${format(selectedDate, "dd MMM yyyy")}</title>
          ${styles}
        </head><body>
          <div class="print-header">
            <h1>Daily Attendance Sheet</h1>
            <p>${format(selectedDate, "EEEE, dd MMMM yyyy")}${isPH ? ' — Public Holiday: ' + publicHolidayMap[dateKey] : ''} | Total Employees: ${employees.length}</p>
          </div>
          <table><thead><tr>
            <th class="employee-cell">Employee</th><th>Status</th><th>MPH</th>
          </tr></thead><tbody>${tableRows}</tbody></table>
          <div class="legend">
            <span><span class="legend-box" style="background:#dcfce7"></span> Present: ${dailyStats.present}</span>
            <span><span class="legend-box" style="background:#fef3c7"></span> Half Day: ${dailyStats.halfDay}</span>
            <span><span class="legend-box" style="background:#fee2e2"></span> Absent: ${dailyStats.absent}</span>
            <span><span class="legend-box" style="background:#f3e8ff"></span> PH = Public Holiday</span>
          </div>
        </body></html>
      `);
    } else {
      const tableRows = employees.map((employee) => {
        const summary = getEmployeeSummary(employee.id);
        const dayCells = daysInMonth.map((day) => {
          const dateKey = format(day, "yyyy-MM-dd");
          const isFuture = day > new Date();
          if (isFuture) return '<td>-</td>';
          if (isPublicHoliday(dateKey)) return '<td class="public-holiday">PH</td>';
          if (isSunday(day)) return '<td class="sunday">S</td>';
          const attendance = attendanceMap[employee.id]?.[dateKey];
          if (attendance) {
            return attendance.totalMph >= 12
              ? '<td class="present">P</td>'
              : '<td class="half-day">H</td>';
          }
          return '<td class="absent">A</td>';
        }).join("");
        return `
          <tr>
            <td class="employee-cell">
              <div class="employee-name">${employee.full_name}</div>
              <div class="employee-code">${employee.employee_code}</div>
            </td>
            ${dayCells}
            <td class="summary-cell">${summary.present}P / ${summary.halfDays}H / ${summary.absent}A / ${summary.ph}PH</td>
          </tr>
        `;
      }).join("");

      const dayHeaders = daysInMonth.map((day) =>
        `<th>${format(day, "EEE")}<br/>${getDate(day)}</th>`
      ).join("");

      printWindow.document.write(`
        <!DOCTYPE html><html><head>
          <title>Attendance Sheet - ${format(currentMonth, "MMMM yyyy")}</title>
          ${styles}
        </head><body>
          <div class="print-header">
            <h1>Monthly Attendance Sheet</h1>
            <p>${format(currentMonth, "MMMM yyyy")} | Total Employees: ${employees.length}</p>
          </div>
          <table><thead><tr>
            <th class="employee-cell">Employee</th>
            ${dayHeaders}
            <th>Summary</th>
          </tr></thead><tbody>${tableRows}</tbody></table>
          <div class="legend">
            <span><span class="legend-box" style="background:#dcfce7"></span> P = Present (Full Day)</span>
            <span><span class="legend-box" style="background:#fef3c7"></span> H = Half Day</span>
            <span><span class="legend-box" style="background:#fee2e2"></span> A = Absent</span>
            <span><span class="legend-box" style="background:#f3e8ff"></span> PH = Public Holiday</span>
          </div>
        </body></html>
      `);
    }

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
  };

  const getAttendanceCell = (employeeId: string, date: Date) => {
    const dateKey = format(date, "yyyy-MM-dd");
    const isFuture = date > new Date();
    const isToday = format(date, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

    if (isFuture) {
      return (
        <div className="w-8 h-8 flex items-center justify-center text-muted-foreground/30">-</div>
      );
    }

    // Public holiday check
    if (isPublicHoliday(dateKey)) {
      return (
        <div
          className={cn(
            "w-8 h-8 flex items-center justify-center rounded text-xs font-medium bg-purple-500/20 text-purple-600",
            isToday && "ring-2 ring-primary"
          )}
          title={`Public Holiday: ${publicHolidayMap[dateKey]}`}
        >
          PH
        </div>
      );
    }

    // Sunday check
    if (isSunday(date)) {
      return (
        <div
          className={cn(
            "w-8 h-8 flex items-center justify-center rounded text-xs font-medium bg-gray-500/20 text-gray-500",
            isToday && "ring-2 ring-primary"
          )}
          title="Sunday"
        >
          S
        </div>
      );
    }

    const attendance = attendanceMap[employeeId]?.[dateKey];
    if (attendance) {
      const isFullDay = attendance.totalMph >= 12;
      const timeNote = (attendance.checkIn || attendance.checkOut)
        ? ` · In: ${attendance.checkIn || "-"} · Out: ${attendance.checkOut || "-"}`
        : "";
      return (
        <div
          className={cn(
            "w-8 h-8 flex items-center justify-center rounded text-xs font-medium",
            isFullDay ? "bg-green-500/20 text-green-600" : "bg-amber-500/20 text-amber-600",
            isToday && "ring-2 ring-primary"
          )}
          title={`${attendance.workType} (${attendance.totalMph} MPH)${timeNote}`}
        >
          {isFullDay ? "P" : "H"}
        </div>
      );
    }

    return (
      <div
        className={cn(
          "w-8 h-8 flex items-center justify-center rounded text-xs font-medium bg-red-500/10 text-red-500",
          isToday && "ring-2 ring-primary"
        )}
      >
        A
      </div>
    );
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Attendance Sheet"
        description="Daily attendance tracking based on productivity entries"
        action={{ label: "Print", onClick: handlePrint, icon: Printer }}
      />

      {/* View Mode Tabs */}
      <div className="flex items-center justify-between mb-6">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
          <TabsList>
            <TabsTrigger value="monthly">Monthly View</TabsTrigger>
            <TabsTrigger value="daily">Daily View</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-green-500/20" />
            <span className="text-sm">P = Present</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-amber-500/20" />
            <span className="text-sm">H = Half Day</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-red-500/10" />
            <span className="text-sm">A = Absent</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-purple-500/20" />
            <span className="text-sm">PH = Public Holiday</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-gray-500/20" />
            <span className="text-sm">S = Sunday</span>
          </div>
        </div>
      </div>

      {viewMode === "monthly" ? (
        <>
          {/* Month Navigation */}
          <div className="flex items-center gap-4 mb-6">
            <Button variant="outline" size="icon" onClick={() => navigateMonth("prev")}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <span className="text-lg font-semibold">{format(currentMonth, "MMMM yyyy")}</span>
            </div>
            <Button variant="outline" size="icon" onClick={() => navigateMonth("next")}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Employees</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{employees.length}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Full Day Entries</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{summaryStats.totalPresent}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Half Day Entries</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600">{summaryStats.totalHalfDays}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Absent Days</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-500">{summaryStats.totalAbsent}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Public Holidays</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-purple-600">{summaryStats.totalPH}</div>
              </CardContent>
            </Card>
          </div>

          {/* Monthly Attendance Grid */}
          <Card>
            <CardContent className="p-0">
              <ScrollArea className="w-full">
                <div className="min-w-max">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b">
                        <th className="sticky left-0 z-10 bg-card px-4 py-3 text-left text-sm font-medium min-w-[200px]">
                          Employee
                        </th>
                        {daysInMonth.map((day) => {
                          const dateKey = format(day, "yyyy-MM-dd");
                          const isPH = isPublicHoliday(dateKey);
                          return (
                            <th
                              key={day.toISOString()}
                              className={cn(
                                "px-1 py-3 text-center text-xs font-medium min-w-[36px]",
                                format(day, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd") && "bg-primary/10",
                                isPH && "bg-purple-500/10",
                                isSunday(day) && !isPH && "bg-gray-100 dark:bg-gray-800"
                              )}
                              title={isPH ? publicHolidayMap[dateKey] : undefined}
                            >
                              <div>{format(day, "EEE")}</div>
                              <div className="font-bold">{getDate(day)}</div>
                            </th>
                          );
                        })}
                        <th className="sticky right-0 z-10 bg-card px-4 py-3 text-center text-sm font-medium min-w-[140px]">
                          Summary
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((employee) => {
                        const summary = getEmployeeSummary(employee.id);
                        return (
                          <tr key={employee.id} className="border-b hover:bg-muted/50">
                            <td className="sticky left-0 z-10 bg-card px-4 py-2">
                              <div className="font-medium text-sm">{employee.full_name}</div>
                              <div className="text-xs text-muted-foreground">{employee.employee_code}</div>
                            </td>
                            {daysInMonth.map((day) => (
                              <td key={day.toISOString()} className="px-1 py-2 text-center">
                                {getAttendanceCell(employee.id, day)}
                              </td>
                            ))}
                            <td className="sticky right-0 z-10 bg-card px-4 py-2">
                              <div className="flex gap-1 justify-center flex-wrap">
                                <Badge variant="secondary" className="bg-green-500/20 text-green-600 text-xs">
                                  {summary.present}P
                                </Badge>
                                <Badge variant="secondary" className="bg-amber-500/20 text-amber-600 text-xs">
                                  {summary.halfDays}H
                                </Badge>
                                <Badge variant="secondary" className="bg-red-500/10 text-red-500 text-xs">
                                  {summary.absent}A
                                </Badge>
                                {summary.ph > 0 && (
                                  <Badge variant="secondary" className="bg-purple-500/20 text-purple-600 text-xs">
                                    {summary.ph}PH
                                  </Badge>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* Daily View */}
          <div className="flex items-center gap-4 mb-6">
            <Button variant="outline" size="icon" onClick={() => navigateDate("prev")}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <span className="text-lg font-semibold">{format(selectedDate, "EEEE, dd MMMM yyyy")}</span>
              {dailyStats.isPH && (
                <Badge className="bg-purple-500/20 text-purple-600 border-purple-300">
                  Public Holiday: {publicHolidayMap[format(selectedDate, "yyyy-MM-dd")]}
                </Badge>
              )}
            </div>
            <Button variant="outline" size="icon" onClick={() => navigateDate("next")}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSelectedDate(new Date())}>
              Today
            </Button>
          </div>

          {/* Daily Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Employees</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{employees.length}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Present (Full Day)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{dailyStats.isPH ? "-" : dailyStats.present}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Present (Half Day)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600">{dailyStats.isPH ? "-" : dailyStats.halfDay}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Absent</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-500">{dailyStats.isPH ? "-" : dailyStats.absent}</div>
              </CardContent>
            </Card>
          </div>

          {/* Daily Attendance List */}
          <Card>
            <CardContent className="p-0">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left text-sm font-medium">Employee</th>
                    <th className="px-4 py-3 text-center text-sm font-medium">Check In</th>
                    <th className="px-4 py-3 text-center text-sm font-medium">Check Out</th>
                    <th className="px-4 py-3 text-center text-sm font-medium">Status</th>
                    <th className="px-4 py-3 text-center text-sm font-medium">MPH</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((employee) => {
                    const attendance = getDailyAttendance(employee.id);
                    const isFuture = selectedDate > new Date();
                    const dateKey = format(selectedDate, "yyyy-MM-dd");
                    const isPH = isPublicHoliday(dateKey);

                    return (
                      <tr key={employee.id} className="border-b hover:bg-muted/50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-sm">{employee.full_name}</div>
                          <div className="text-xs text-muted-foreground">{employee.employee_code}</div>
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-sm">
                          {isFuture || isPH ? "-" : (attendance?.checkIn || "-")}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-sm">
                          {isFuture || isPH ? "-" : (attendance?.checkOut || "-")}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {isFuture ? (
                            <Badge variant="secondary">-</Badge>
                          ) : isPH ? (
                            <Badge variant="secondary" className="bg-purple-500/20 text-purple-600">
                              Public Holiday
                            </Badge>
                          ) : attendance ? (
                            <Badge
                              variant="secondary"
                              className={cn(
                                attendance.totalMph >= 12
                                  ? "bg-green-500/20 text-green-600"
                                  : "bg-amber-500/20 text-amber-600"
                              )}
                            >
                              {attendance.totalMph >= 12 ? "Present" : "Half Day"}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-red-500/10 text-red-500">
                              Absent
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center font-medium">
                          {isFuture ? "-" : isPH ? "-" : attendance?.totalMph || 0}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </ERPLayout>
  );
};

export default LabourAttendancePage;
