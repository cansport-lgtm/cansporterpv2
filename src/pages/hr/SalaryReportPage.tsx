import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DollarSign, Download, Users, Search, Building, Plus, Trash2, CalendarDays, Printer, FileText, Lock, Unlock, ShieldCheck, Clock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format, startOfMonth, endOfMonth, getDaysInMonth, isSunday, eachDayOfInterval, getDay, parseISO } from "date-fns";
import { toast } from "sonner";
import * as XLSX from "xlsx";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function getWorkingDays(year: number, month: number, publicHolidayDates: string[] = []) {
  const start = new Date(year, month, 1);
  const end = endOfMonth(start);
  const days = eachDayOfInterval({ start, end });
  const holidaySet = new Set(publicHolidayDates);
  return days.filter((d) => !isSunday(d) && !holidaySet.has(format(d, 'yyyy-MM-dd'))).length;
}

interface EmployeeSalary {
  id: string;
  employee_code: string;
  full_name: string;
  department: string;
  designation: string;
  basic_salary: number;
  allowances: number;
  gross: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  paidLeaveDays: number;
  paidSundaysHolidays: number;
  effectiveDays: number;
  workingDays: number;
  earnedSalary: number;
  attendanceAllowance: number;
  overtimeAmount: number;
  advanceDeduction: number;
  loanDeduction: number;
  totalDeduction: number;
  netSalary: number;
  is_active: boolean;
}

export default function SalaryReportPage() {
  const queryClient = useQueryClient();
  const { hasRole, user } = useAuth();
  const isSuperAdmin = hasRole('super_admin');
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Advance dialog
  const [advDialogOpen, setAdvDialogOpen] = useState(false);
  const [advEmployeeId, setAdvEmployeeId] = useState("");
  const [advAmount, setAdvAmount] = useState("");
  const [advDate, setAdvDate] = useState(format(now, "yyyy-MM-dd"));
  const [advRemarks, setAdvRemarks] = useState("");

  // Overtime dialog
  const [otDialogOpen, setOtDialogOpen] = useState(false);
  const [otEmployeeId, setOtEmployeeId] = useState("");
  const [otHours, setOtHours] = useState("");
  const [otAmount, setOtAmount] = useState("");
  const [otDate, setOtDate] = useState(format(now, "yyyy-MM-dd"));
  const [otRemarks, setOtRemarks] = useState("");

  const monthStart = format(startOfMonth(new Date(selectedYear, selectedMonth)), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(new Date(selectedYear, selectedMonth)), "yyyy-MM-dd");

  // Fetch public holidays for this month
  const { data: publicHolidays } = useQuery({
    queryKey: ["public-holidays-salary", selectedYear, selectedMonth],
    queryFn: async () => {
      const { data } = await supabase
        .from("public_holidays" as any)
        .select("holiday_date")
        .eq("is_active", true)
        .gte("holiday_date", monthStart)
        .lte("holiday_date", monthEnd);
      return ((data as any[]) || []).map((h: any) => h.holiday_date);
    },
  });

  // Fetch extended public holidays (including days before/after month for boundary adjacent-day checks)
  const extendedStart = format(new Date(selectedYear, selectedMonth, -10), "yyyy-MM-dd");
  const extendedEnd = format(new Date(selectedYear, selectedMonth + 1, 10), "yyyy-MM-dd");
  const { data: extendedPublicHolidays } = useQuery({
    queryKey: ["public-holidays-extended", selectedYear, selectedMonth],
    queryFn: async () => {
      const { data } = await supabase
        .from("public_holidays" as any)
        .select("holiday_date")
        .eq("is_active", true)
        .gte("holiday_date", extendedStart)
        .lte("holiday_date", extendedEnd);
      return ((data as any[]) || []).map((h: any) => h.holiday_date as string);
    },
  });

  const workingDays = getWorkingDays(selectedYear, selectedMonth, publicHolidays || []);

  const { data: departments } = useQuery({
    queryKey: ["hr-salary-departments"],
    queryFn: async () => {
      const { data } = await supabase.from("production_departments").select("id, name").order("name");
      return data || [];
    },
  });

  const { data: employees } = useQuery({
    queryKey: ["hr-salary-employees", departmentFilter],
    queryFn: async () => {
      let query = supabase
        .from("employees")
        .select("id, employee_code, full_name, basic_salary, allowances, attendance_allowance, department_id, is_active, production_departments(name), designations(name)")
        .eq("is_active", true)
        .order("full_name");
      if (departmentFilter !== "all") query = query.eq("department_id", departmentFilter);
      const { data } = await query;
      return (data as any[]) || [];
    },
  });

  const { data: attendance } = useQuery({
    queryKey: ["hr-salary-attendance", monthStart, monthEnd],
    queryFn: async () => {
      const { data } = await supabase
        .from("attendance")
        .select("employee_id, status, attendance_date")
        .gte("attendance_date", extendedStart)
        .lte("attendance_date", extendedEnd);
      return data || [];
    },
  });

  const { data: advances } = useQuery({
    queryKey: ["hr-salary-advances", monthStart, monthEnd],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_advances" as any)
        .select("*")
        .gte("advance_date", monthStart)
        .lte("advance_date", monthEnd)
        .order("advance_date");
      return (data as any[]) || [];
    },
  });

  const { data: overtime } = useQuery({
    queryKey: ["hr-salary-overtime", monthStart, monthEnd],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_overtime" as any)
        .select("*")
        .gte("overtime_date", monthStart)
        .lte("overtime_date", monthEnd)
        .order("overtime_date");
      return (data as any[]) || [];
    },
  });

  const { data: loans } = useQuery({
    queryKey: ["hr-salary-loans"],
    queryFn: async () => {
      const { data } = await supabase
        .from("employee_loans")
        .select("id, employee_id, monthly_installment, remaining_amount, status, paid_installments, total_installments")
        .in("status", ["approved", "active"]);
      return data || [];
    },
  });

  // Fetch approved paid leaves for this month
  const { data: paidLeaves } = useQuery({
    queryKey: ["hr-salary-paid-leaves", monthStart, monthEnd],
    queryFn: async () => {
      const { data } = await supabase
        .from("leave_requests")
        .select("employee_id, total_days, leave_types!inner(is_paid)")
        .eq("status", "approved")
        .gte("start_date", monthStart)
        .lte("start_date", monthEnd);
      return (data as any[]) || [];
    },
  });

  // Check if this month is locked
  const { data: salaryLock } = useQuery({
    queryKey: ["salary-lock", selectedMonth, selectedYear],
    queryFn: async () => {
      const { data } = await supabase
        .from("salary_locks" as any)
        .select("*")
        .eq("module", "hr")
        .eq("lock_month", selectedMonth)
        .eq("lock_year", selectedYear)
        .maybeSingle();
      return data as any;
    },
  });

  const isLocked = !!salaryLock;

  const lockSalaryMutation = useMutation({
    mutationFn: async () => {
      // Lock salary
      const { error } = await supabase.from("salary_locks" as any).insert({
        module: "hr",
        lock_month: selectedMonth,
        lock_year: selectedYear,
        locked_by: user?.id,
        total_net_salary: totals.net,
        total_employees: totals.count,
      } as any);
      if (error) throw error;

      // Auto-deduct loans
      const activeLoans = (loans || []).filter((l) => Number(l.remaining_amount) > 0);
      for (const loan of activeLoans) {
        const newPaid = (loan.paid_installments || 0) + 1;
        const newRemaining = Math.max(0, Number(loan.remaining_amount) - Number(loan.monthly_installment));
        const newStatus = newPaid >= loan.total_installments ? "completed" : "active";

        await supabase.from("employee_loans").update({
          paid_installments: newPaid,
          remaining_amount: newRemaining,
          status: newStatus,
        }).eq("id", loan.id);

        // Record payment history
        await supabase.from("loan_payment_history" as any).insert({
          loan_id: loan.id,
          employee_id: loan.employee_id,
          payment_month: selectedMonth,
          payment_year: selectedYear,
          amount: Number(loan.monthly_installment),
        } as any);
      }
    },
    onSuccess: () => {
      toast.success(`Salary locked for ${MONTHS[selectedMonth]} ${selectedYear}`);
      queryClient.invalidateQueries({ queryKey: ["salary-lock"] });
      queryClient.invalidateQueries({ queryKey: ["hr-salary-loans"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const unlockSalaryMutation = useMutation({
    mutationFn: async () => {
      // Reverse loan payments
      const { data: payments } = await supabase
        .from("loan_payment_history" as any)
        .select("*")
        .eq("payment_month", selectedMonth)
        .eq("payment_year", selectedYear);

      for (const payment of ((payments as any[]) || [])) {
        // Restore loan
        const { data: loan } = await supabase
          .from("employee_loans")
          .select("*")
          .eq("id", payment.loan_id)
          .maybeSingle();
        
        if (loan) {
          const newPaid = Math.max(0, (loan.paid_installments || 0) - 1);
          const newRemaining = Number(loan.remaining_amount) + Number(payment.amount);
          await supabase.from("employee_loans").update({
            paid_installments: newPaid,
            remaining_amount: newRemaining,
            status: newPaid < loan.total_installments ? "active" : "completed",
          }).eq("id", payment.loan_id);
        }

        // Delete payment record
        await supabase.from("loan_payment_history" as any).delete().eq("id", payment.id);
      }

      // Unlock salary
      const { error } = await supabase
        .from("salary_locks" as any)
        .delete()
        .eq("module", "hr")
        .eq("lock_month", selectedMonth)
        .eq("lock_year", selectedYear);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Salary unlocked for ${MONTHS[selectedMonth]} ${selectedYear}`);
      queryClient.invalidateQueries({ queryKey: ["salary-lock"] });
      queryClient.invalidateQueries({ queryKey: ["hr-salary-loans"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Advance mutations
  const addAdvanceMutation = useMutation({
    mutationFn: async (empId?: string) => {
      if (isLocked) throw new Error("Salary is locked for this month. No changes allowed.");
      const employeeId = empId || advEmployeeId;
      const { error } = await supabase.from("hr_advances" as any).insert({
        employee_id: employeeId,
        amount: Number(advAmount),
        advance_date: advDate,
        remarks: advRemarks || null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Advance added");
      queryClient.invalidateQueries({ queryKey: ["hr-salary-advances"] });
      setAdvDialogOpen(false);
      setAdvAmount("");
      setAdvRemarks("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteAdvanceMutation = useMutation({
    mutationFn: async (id: string) => {
      if (isLocked) throw new Error("Salary is locked for this month. No changes allowed.");
      const { error } = await supabase.from("hr_advances" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Advance deleted");
      queryClient.invalidateQueries({ queryKey: ["hr-salary-advances"] });
    },
  });

  // Overtime mutations
  const addOvertimeMutation = useMutation({
    mutationFn: async (empId?: string) => {
      if (isLocked) throw new Error("Salary is locked for this month. No changes allowed.");
      const employeeId = empId || otEmployeeId;
      const { error } = await supabase.from("hr_overtime" as any).insert({
        employee_id: employeeId,
        overtime_date: otDate,
        hours: Number(otHours) || 0,
        amount: Number(otAmount),
        remarks: otRemarks || null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Overtime added");
      queryClient.invalidateQueries({ queryKey: ["hr-salary-overtime"] });
      setOtDialogOpen(false);
      setOtHours("");
      setOtAmount("");
      setOtRemarks("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteOvertimeMutation = useMutation({
    mutationFn: async (id: string) => {
      if (isLocked) throw new Error("Salary is locked for this month. No changes allowed.");
      const { error } = await supabase.from("hr_overtime" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Overtime deleted");
      queryClient.invalidateQueries({ queryKey: ["hr-salary-overtime"] });
    },
  });

  // Build attendance map (counts within month only)
  const attendanceMap = useMemo(() => {
    const map: Record<string, { present: number; half_day: number; late: number }> = {};
    attendance?.forEach((a) => {
      if (a.attendance_date < monthStart || a.attendance_date > monthEnd) return;
      if (!map[a.employee_id]) map[a.employee_id] = { present: 0, half_day: 0, late: 0 };
      if (a.status === "present") map[a.employee_id].present++;
      else if (a.status === "half_day") map[a.employee_id].half_day++;
      else if (a.status === "late") { map[a.employee_id].present++; map[a.employee_id].late++; }
    });
    return map;
  }, [attendance, monthStart, monthEnd]);

  // Build per-employee date-level attendance map (for adjacent day checks, includes extended range)
  const employeePresentDatesMap = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    attendance?.forEach((a) => {
      if (a.status === "present" || a.status === "late" || a.status === "half_day" || a.status === "on_leave") {
        if (!map[a.employee_id]) map[a.employee_id] = new Set();
        map[a.employee_id].add(a.attendance_date);
      }
    });
    return map;
  }, [attendance]);

  // Helper: find nearest working day skipping Sundays and public holidays
  const findAdjacentWorkingDay = (date: Date, direction: 'forward' | 'backward', holidaySet: Set<string>): Date => {
    const step = direction === 'forward' ? 1 : -1;
    let current = new Date(date.getTime() + step * 86400000);
    let maxIterations = 10;
    while (maxIterations-- > 0) {
      const dayOfWeek = getDay(current);
      const dateStr = format(current, 'yyyy-MM-dd');
      if (dayOfWeek !== 0 && !holidaySet.has(dateStr)) {
        return current;
      }
      current = new Date(current.getTime() + step * 86400000);
    }
    return current;
  };

  // Calculate unpaid holidays and paid holidays per employee
  const holidayCalcMap = useMemo(() => {
    const map: Record<string, { unpaid: number; paid: number }> = {};
    if (!employees || !attendance) return map;
    
    const allHolidayDates = extendedPublicHolidays || [];
    const holidaySet = new Set(allHolidayDates);
    const mStart = startOfMonth(new Date(selectedYear, selectedMonth));
    const mEnd = endOfMonth(mStart);
    const allDays = eachDayOfInterval({ start: mStart, end: mEnd });
    
    const monthHolidayDates = (publicHolidays || []);
    const totalSundays = allDays.filter(d => getDay(d) === 0).length;
    const totalPHsNotOnSunday = monthHolidayDates.filter(h => getDay(parseISO(h)) !== 0).length;
    const totalHolidayDays = totalSundays + totalPHsNotOnSunday;
    
    employees.forEach((emp) => {
      const presentDates = employeePresentDatesMap[emp.id] || new Set();
      let paidDays = 0;
      
      allDays.forEach(day => {
        if (getDay(day) !== 0) return;
        const workDayBefore = findAdjacentWorkingDay(day, 'backward', holidaySet);
        const workDayAfter = findAdjacentWorkingDay(day, 'forward', holidaySet);
        if (presentDates.has(format(workDayBefore, 'yyyy-MM-dd')) || presentDates.has(format(workDayAfter, 'yyyy-MM-dd'))) {
          paidDays++;
        }
      });
      
      monthHolidayDates.forEach(holidayStr => {
        const holidayDate = parseISO(holidayStr);
        if (getDay(holidayDate) === 0) return;
        const workDayBefore = findAdjacentWorkingDay(holidayDate, 'backward', holidaySet);
        const workDayAfter = findAdjacentWorkingDay(holidayDate, 'forward', holidaySet);
        if (presentDates.has(format(workDayBefore, 'yyyy-MM-dd')) || presentDates.has(format(workDayAfter, 'yyyy-MM-dd'))) {
          paidDays++;
        }
      });
      
      map[emp.id] = { paid: paidDays, unpaid: Math.max(0, totalHolidayDays - paidDays) };
    });
    
    return map;
  }, [employees, attendance, employeePresentDatesMap, publicHolidays, extendedPublicHolidays, selectedYear, selectedMonth]);

  // Build advance map
  const advanceMap = useMemo(() => {
    const map: Record<string, number> = {};
    advances?.forEach((a: any) => {
      map[a.employee_id] = (map[a.employee_id] || 0) + Number(a.amount);
    });
    return map;
  }, [advances]);

  // Build overtime map
  const overtimeMap = useMemo(() => {
    const map: Record<string, number> = {};
    overtime?.forEach((o: any) => {
      map[o.employee_id] = (map[o.employee_id] || 0) + Number(o.amount);
    });
    return map;
  }, [overtime]);

  // Build loan map
  const loanMap = useMemo(() => {
    const map: Record<string, number> = {};
    loans?.forEach((l) => {
      if (Number(l.remaining_amount) > 0) {
        map[l.employee_id] = (map[l.employee_id] || 0) + Number(l.monthly_installment);
      }
    });
    return map;
  }, [loans]);

  // Build paid leave map
  const paidLeaveMap = useMemo(() => {
    const map: Record<string, number> = {};
    paidLeaves?.forEach((pl: any) => {
      if (pl.leave_types?.is_paid) {
        map[pl.employee_id] = (map[pl.employee_id] || 0) + Number(pl.total_days);
      }
    });
    return map;
  }, [paidLeaves]);

  const totalDaysInMonth = getDaysInMonth(new Date(selectedYear, selectedMonth));

  const salaryData: EmployeeSalary[] = useMemo(() => {
    if (!employees) return [];
    return employees.map((e) => {
      const basic = Number(e.basic_salary) || 0;
      const allow = Number(e.allowances) || 0;
      const gross = basic + allow;
      const att = attendanceMap[e.id] || { present: 0, half_day: 0, late: 0 };
      const presentDays = att.present;
      const halfDays = att.half_day;
      const paidLeaveDays = paidLeaveMap[e.id] || 0;
      const holidayCalc = holidayCalcMap[e.id] || { paid: 0, unpaid: 0 };
      const paidSundaysHolidays = holidayCalc.paid;
      const unpaidHolidays = holidayCalc.unpaid;
      const effectiveDays = presentDays + halfDays * 0.5 + paidLeaveDays;
      // absentDays = working day absences + unpaid holidays (Sundays/PHs where adjacent days not attended)
      const absentDays = Math.max(0, workingDays - presentDays - halfDays * 0.5 - paidLeaveDays) + unpaidHolidays;
      const perDayRate = totalDaysInMonth > 0 ? gross / totalDaysInMonth : 0;
      const earnedSalary = Math.round(gross - (absentDays * perDayRate));
      
      // Attendance allowance: auto-add if 0 absent and 0 half days and no unpaid holidays
      const attAllowanceConfig = Number((e as any).attendance_allowance) || 0;
      const attendanceAllowance = (absentDays === 0 && halfDays === 0 && paidLeaveDays === 0) ? attAllowanceConfig : 0;
      
      const overtimeAmount = overtimeMap[e.id] || 0;
      const advanceDeduction = advanceMap[e.id] || 0;
      const loanDeduction = loanMap[e.id] || 0;
      const totalDeduction = advanceDeduction + loanDeduction;
      const netSalary = Math.max(0, earnedSalary + attendanceAllowance + overtimeAmount - totalDeduction);

      return {
        id: e.id,
        employee_code: e.employee_code,
        full_name: e.full_name,
        department: e.production_departments?.name || "-",
        designation: e.designations?.name || "-",
        basic_salary: basic,
        allowances: allow,
        gross,
        presentDays,
        absentDays,
        halfDays,
        paidLeaveDays,
        paidSundaysHolidays,
        effectiveDays,
        workingDays,
        earnedSalary,
        attendanceAllowance,
        overtimeAmount,
        advanceDeduction,
        loanDeduction,
        totalDeduction,
        netSalary,
        is_active: e.is_active,
      };
    });
  }, [employees, attendanceMap, advanceMap, overtimeMap, loanMap, paidLeaveMap, holidayCalcMap, workingDays, totalDaysInMonth]);

  const filtered = useMemo(() => {
    if (!search) return salaryData;
    const s = search.toLowerCase();
    return salaryData.filter(
      (e) => e.full_name.toLowerCase().includes(s) || e.employee_code.toLowerCase().includes(s)
    );
  }, [salaryData, search]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (t, e) => ({
        basic: t.basic + e.basic_salary,
        allowances: t.allowances + e.allowances,
        gross: t.gross + e.gross,
        earned: t.earned + e.earnedSalary,
        attAllowance: t.attAllowance + e.attendanceAllowance,
        overtime: t.overtime + e.overtimeAmount,
        advances: t.advances + e.advanceDeduction,
        loans: t.loans + e.loanDeduction,
        deductions: t.deductions + e.totalDeduction,
        net: t.net + e.netSalary,
        count: t.count + 1,
      }),
      { basic: 0, allowances: 0, gross: 0, earned: 0, attAllowance: 0, overtime: 0, advances: 0, loans: 0, deductions: 0, net: 0, count: 0 }
    );
  }, [filtered]);

  // Dept summary for chart
  const deptSummary = useMemo(() => {
    const map: Record<string, { name: string; net: number; count: number }> = {};
    filtered.forEach((e) => {
      if (!map[e.department]) map[e.department] = { name: e.department, net: 0, count: 0 };
      map[e.department].net += e.netSalary;
      map[e.department].count++;
    });
    return Object.values(map).sort((a, b) => b.net - a.net);
  }, [filtered]);

  const monthAdvances = useMemo(() => (advances as any[]) || [], [advances]);
  const monthOvertime = useMemo(() => (overtime as any[]) || [], [overtime]);

  // Inline advance: pre-fill employee and open dialog
  const handleInlineAdvance = (empId: string) => {
    setAdvEmployeeId(empId);
    setAdvAmount("");
    setAdvDate(format(new Date(selectedYear, selectedMonth, Math.min(now.getDate(), totalDaysInMonth)), "yyyy-MM-dd"));
    setAdvRemarks("");
    setAdvDialogOpen(true);
  };

  // Inline overtime: pre-fill employee and open dialog
  const handleInlineOvertime = (empId: string) => {
    setOtEmployeeId(empId);
    setOtHours("");
    setOtAmount("");
    setOtDate(format(new Date(selectedYear, selectedMonth, Math.min(now.getDate(), totalDaysInMonth)), "yyyy-MM-dd"));
    setOtRemarks("");
    setOtDialogOpen(true);
  };

  const handleExport = () => {
    const rows = filtered.map((e, i) => ({
      "#": i + 1,
      Code: e.employee_code,
      Employee: e.full_name,
      Department: e.department,
      "Basic Salary": e.basic_salary,
      "Allowance": e.allowances,
      "Gross Salary": e.gross,
      "Working Days": e.workingDays,
      Present: e.presentDays,
      "Half Days": e.halfDays,
      "Paid Leave": e.paidLeaveDays,
      "Paid Sun/PH": e.paidSundaysHolidays,
      Absent: e.absentDays,
      "Earned Salary": e.earnedSalary,
      "Att. Allowance": e.attendanceAllowance,
      "Overtime": e.overtimeAmount,
      Advances: e.advanceDeduction,
      "Loan EMI": e.loanDeduction,
      "Total Deduction": e.totalDeduction,
      "Net Salary": e.netSalary,
    }));
    rows.push({
      "#": "" as any,
      Code: "",
      Employee: "TOTAL",
      Department: "",
      "Basic Salary": totals.basic,
      "Allowance": totals.allowances,
      "Gross Salary": totals.gross,
      "Working Days": workingDays,
      Present: "" as any,
      "Half Days": "" as any,
      "Paid Leave": "" as any,
      "Paid Sun/PH": "" as any,
      Absent: "" as any,
      "Earned Salary": totals.earned,
      "Att. Allowance": totals.attAllowance,
      "Overtime": totals.overtime,
      Advances: totals.advances,
      "Loan EMI": totals.loans,
      "Total Deduction": totals.deductions,
      "Net Salary": totals.net,
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Salary Report");
    XLSX.writeFile(wb, `Salary_${MONTHS[selectedMonth]}_${selectedYear}.xlsx`);
  };

  const handlePrintSalarySheet = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const rows = filtered.map((e, i) => `
      <tr>
        <td>${i + 1}</td><td>${e.employee_code}</td><td>${e.full_name}</td><td>${e.department}</td>
        <td class="r">Rs. ${e.basic_salary.toLocaleString()}</td>
        <td class="r">Rs. ${e.allowances.toLocaleString()}</td>
        <td class="r">Rs. ${e.gross.toLocaleString()}</td><td class="c">${e.presentDays}</td>
        <td class="c">${e.halfDays}</td><td class="c">${e.paidLeaveDays}</td><td class="c">${e.absentDays}</td>
        <td class="r">Rs. ${e.earnedSalary.toLocaleString()}</td>
        <td class="r">${e.attendanceAllowance > 0 ? `Rs. ${e.attendanceAllowance.toLocaleString()}` : "-"}</td>
        <td class="r">${e.overtimeAmount > 0 ? `Rs. ${e.overtimeAmount.toLocaleString()}` : "-"}</td>
        <td class="r">${e.advanceDeduction > 0 ? `Rs. ${e.advanceDeduction.toLocaleString()}` : "-"}</td>
        <td class="r">${e.loanDeduction > 0 ? `Rs. ${e.loanDeduction.toLocaleString()}` : "-"}</td>
        <td class="r">${e.totalDeduction > 0 ? `Rs. ${e.totalDeduction.toLocaleString()}` : "-"}</td>
        <td class="r b">Rs. ${e.netSalary.toLocaleString()}</td>
      </tr>`).join("");
    printWindow.document.write(`<html><head><title>Salary Sheet - ${MONTHS[selectedMonth]} ${selectedYear}</title>
      <style>
        body{font-family:Arial,sans-serif;margin:20px;font-size:10px}
        h2{text-align:center;margin-bottom:4px}
        p.sub{text-align:center;color:#666;margin-top:0}
        table{width:100%;border-collapse:collapse;margin-top:10px}
        th,td{border:1px solid #ccc;padding:3px 5px;text-align:left}
        th{background:#f0f0f0;font-weight:600}
        .r{text-align:right} .c{text-align:center} .b{font-weight:700}
        tfoot td{font-weight:700;background:#f9f9f9}
        @media print{body{margin:10px}}
      </style></head><body>
      <h2>Salary Sheet</h2>
      <p class="sub">${MONTHS[selectedMonth]} ${selectedYear} | Working Days: ${workingDays} | Days in Month: ${totalDaysInMonth} | Per Day Rate = Gross ÷ ${totalDaysInMonth}</p>
      <table>
        <thead><tr><th>#</th><th>Code</th><th>Employee</th><th>Dept</th><th class="r">Basic</th><th class="r">Allow</th><th class="r">Gross</th>
        <th class="c">Pres</th><th class="c">Half</th><th class="c">PL</th><th class="c">Abs</th>
        <th class="r">Earned</th><th class="r">Att.A</th><th class="r">OT</th><th class="r">Adv</th><th class="r">Loan</th>
        <th class="r">Ded</th><th class="r">Net</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="4">Total (${totals.count})</td>
        <td class="r">Rs. ${totals.basic.toLocaleString()}</td>
        <td class="r">Rs. ${totals.allowances.toLocaleString()}</td>
        <td class="r">Rs. ${totals.gross.toLocaleString()}</td><td colspan="4"></td>
        <td class="r">Rs. ${totals.earned.toLocaleString()}</td>
        <td class="r">Rs. ${totals.attAllowance.toLocaleString()}</td>
        <td class="r">Rs. ${totals.overtime.toLocaleString()}</td>
        <td class="r">Rs. ${totals.advances.toLocaleString()}</td>
        <td class="r">Rs. ${totals.loans.toLocaleString()}</td>
        <td class="r">Rs. ${totals.deductions.toLocaleString()}</td>
        <td class="r">Rs. ${totals.net.toLocaleString()}</td></tr></tfoot>
      </table></body></html>`);
    printWindow.document.close();
    printWindow.print();
  };

  const handlePrintPayslip = (emp: EmployeeSalary) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const empAdvances = monthAdvances.filter((a: any) => a.employee_id === emp.id);
    const advRows = empAdvances.length > 0
      ? empAdvances.map((a: any) => `<tr><td>${format(new Date(a.advance_date), "dd MMM yyyy")}</td><td class="r">Rs. ${Number(a.amount).toLocaleString()}</td><td>${a.remarks || "-"}</td></tr>`).join("")
      : `<tr><td colspan="3" style="text-align:center;color:#999">No advances</td></tr>`;

    const empOT = monthOvertime.filter((o: any) => o.employee_id === emp.id);
    const otRows = empOT.length > 0
      ? empOT.map((o: any) => `<tr><td>${format(new Date(o.overtime_date), "dd MMM yyyy")}</td><td class="r">${Number(o.hours)} hrs</td><td class="r">Rs. ${Number(o.amount).toLocaleString()}</td><td>${o.remarks || "-"}</td></tr>`).join("")
      : `<tr><td colspan="4" style="text-align:center;color:#999">No overtime</td></tr>`;

    // Get loan details for this employee
    const empLoans = (loans || []).filter((l) => l.employee_id === emp.id && Number(l.remaining_amount) > 0);
    const loanRows = empLoans.length > 0
      ? empLoans.map((l) => `<tr><td>Rs. ${Number(l.monthly_installment).toLocaleString()}</td><td>${l.paid_installments}/${l.total_installments}</td><td>Rs. ${Number(l.remaining_amount).toLocaleString()}</td></tr>`).join("")
      : "";

    printWindow.document.write(`<html><head><title>Payslip - ${emp.full_name}</title>
      <style>
        body{font-family:Arial,sans-serif;margin:30px;font-size:12px;max-width:700px;margin:30px auto}
        h2{text-align:center;margin-bottom:2px}
        p.sub{text-align:center;color:#666;margin-top:0;margin-bottom:20px}
        .section{margin-bottom:16px}
        .section h4{margin:0 0 6px;padding-bottom:4px;border-bottom:1px solid #ccc}
        table{width:100%;border-collapse:collapse}
        td,th{padding:5px 8px;text-align:left;border-bottom:1px solid #eee}
        .r{text-align:right} .b{font-weight:700}
        .total-row td{border-top:2px solid #333;font-weight:700;font-size:14px;padding-top:10px}
        .footer{margin-top:60px;display:flex;justify-content:space-between}
        .footer div{border-top:1px solid #333;padding-top:4px;width:200px;text-align:center}
        @media print{body{margin:20px auto}}
      </style></head><body>
      <h2>Pay Slip</h2>
      <p class="sub">${MONTHS[selectedMonth]} ${selectedYear}</p>

      <div class="section">
        <h4>Employee Details</h4>
        <table>
          <tr><td class="b" style="width:150px">Employee Code</td><td>${emp.employee_code}</td>
              <td class="b" style="width:120px">Department</td><td>${emp.department}</td></tr>
          <tr><td class="b">Employee Name</td><td>${emp.full_name}</td>
              <td class="b">Designation</td><td>${emp.designation}</td></tr>
        </table>
      </div>

      <div class="section">
        <h4>Earnings</h4>
        <table>
          <tr><td>Basic Salary</td><td class="r">Rs. ${emp.basic_salary.toLocaleString()}</td></tr>
          <tr><td>Allowances</td><td class="r">Rs. ${emp.allowances.toLocaleString()}</td></tr>
          <tr><td class="b">Gross Salary</td><td class="r b">Rs. ${emp.gross.toLocaleString()}</td></tr>
        </table>
      </div>

      <div class="section">
        <h4>Attendance & Calculation</h4>
        <table>
          <tr><td>Days in Month</td><td class="r">${totalDaysInMonth}</td></tr>
          <tr><td>Working Days</td><td class="r">${emp.workingDays}</td></tr>
          <tr><td>Present Days</td><td class="r">${emp.presentDays}</td></tr>
          <tr><td>Half Days</td><td class="r">${emp.halfDays}</td></tr>
          <tr><td>Paid Leave Days</td><td class="r">${emp.paidLeaveDays}</td></tr>
          <tr><td>Paid Sundays/Public Holidays</td><td class="r">${emp.paidSundaysHolidays}</td></tr>
          <tr><td>Absent Days</td><td class="r">${emp.absentDays}</td></tr>
          <tr><td class="b">Per Day Rate (Gross ÷ ${totalDaysInMonth})</td><td class="r b">Rs. ${Math.round(emp.gross / totalDaysInMonth).toLocaleString()}</td></tr>
          <tr><td class="b">Absent Deduction</td><td class="r b">Rs. ${Math.round(emp.absentDays * emp.gross / totalDaysInMonth).toLocaleString()}</td></tr>
          <tr><td class="b">Earned Salary</td><td class="r b">Rs. ${emp.earnedSalary.toLocaleString()}</td></tr>
          ${emp.attendanceAllowance > 0 ? `<tr><td class="b" style="color:blue">Attendance Allowance (100% Present)</td><td class="r b" style="color:blue">Rs. ${emp.attendanceAllowance.toLocaleString()}</td></tr>` : ''}
        </table>
      </div>

      ${emp.overtimeAmount > 0 ? `<div class="section">
        <h4>Overtime</h4>
        <table><thead><tr><th>Date</th><th class="r">Hours</th><th class="r">Amount</th><th>Remarks</th></tr></thead>
        <tbody>${otRows}</tbody>
        <tfoot><tr><td colspan="2" class="b">Total Overtime</td><td class="r b" colspan="2">Rs. ${emp.overtimeAmount.toLocaleString()}</td></tr></tfoot></table>
      </div>` : ""}

      <div class="section">
        <h4>Advances</h4>
        <table><thead><tr><th>Date</th><th class="r">Amount</th><th>Remarks</th></tr></thead>
        <tbody>${advRows}</tbody></table>
      </div>

      <div class="section">
        <h4>Deductions</h4>
        <table>
          <tr><td>Advance Deduction</td><td class="r">Rs. ${emp.advanceDeduction.toLocaleString()}</td></tr>
          <tr><td>Loan EMI</td><td class="r">Rs. ${emp.loanDeduction.toLocaleString()}</td></tr>
          <tr><td class="b">Total Deductions</td><td class="r b">Rs. ${emp.totalDeduction.toLocaleString()}</td></tr>
        </table>
      </div>

      ${loanRows ? `<div class="section">
        <h4>Loan Details</h4>
        <table><thead><tr><th>Monthly EMI</th><th>Paid/Total</th><th>Remaining</th></tr></thead>
        <tbody>${loanRows}</tbody></table>
      </div>` : ""}

      <table><tr class="total-row"><td>Net Payable</td><td class="r">Rs. ${emp.netSalary.toLocaleString()}</td></tr></table>

      <div class="footer">
        <div>Employee Signature</div>
        <div>Authorized Signature</div>
      </div>
      </body></html>`);
    printWindow.document.close();
    printWindow.print();
  };

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Salary Report" description="Attendance-based salary calculation with deductions" />

        {/* Month/Year & Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3 items-center">
              <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search employee..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departments?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={handleExport}><Download className="h-4 w-4 mr-2" />Export</Button>
              <Button variant="outline" onClick={handlePrintSalarySheet}><Printer className="h-4 w-4 mr-2" />Print Sheet</Button>
              {isSuperAdmin && !isLocked && (
                <Button variant="default" className="bg-amber-600 hover:bg-amber-700" onClick={() => {
                  if (confirm(`Are you sure you want to lock salary for ${MONTHS[selectedMonth]} ${selectedYear}? This will also auto-deduct loan EMIs.`)) {
                    lockSalaryMutation.mutate();
                  }
                }}>
                  <Lock className="h-4 w-4 mr-2" />Lock Salary
                </Button>
              )}
              {isSuperAdmin && isLocked && (
                <Button variant="destructive" onClick={() => {
                  if (confirm(`Are you sure you want to unlock salary for ${MONTHS[selectedMonth]} ${selectedYear}? Loan EMI deductions will be reversed.`)) {
                    unlockSalaryMutation.mutate();
                  }
                }}>
                  <Unlock className="h-4 w-4 mr-2" />Unlock Salary
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Locked Banner */}
        {isLocked && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-4 py-3">
            <ShieldCheck className="h-5 w-5 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-300">Salary Locked for {MONTHS[selectedMonth]} {selectedYear}</p>
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Locked on {salaryLock?.locked_at ? format(new Date(salaryLock.locked_at), "dd MMM yyyy, hh:mm a") : "N/A"} — No modifications allowed{!isSuperAdmin ? '' : ' (Super Admin can unlock)'}
              </p>
            </div>
          </div>
        )}

        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <MetricCard title="Employees" value={totals.count} icon={Users} />
          <MetricCard title="Working Days" value={workingDays} icon={CalendarDays} />
          <MetricCard title="Holidays" value={(publicHolidays || []).length} icon={CalendarDays} />
          <MetricCard title="Total Gross" value={`Rs. ${totals.gross.toLocaleString()}`} icon={DollarSign} />
          <MetricCard title="Total Earned" value={`Rs. ${totals.earned.toLocaleString()}`} icon={DollarSign} />
          <MetricCard title="Total Overtime" value={`Rs. ${totals.overtime.toLocaleString()}`} icon={Clock} />
          <MetricCard title="Total Deductions" value={`Rs. ${totals.deductions.toLocaleString()}`} icon={DollarSign} />
          <MetricCard title="Net Payable" value={`Rs. ${totals.net.toLocaleString()}`} icon={DollarSign} />
        </div>

        {/* Chart + Advances + Overtime */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Building className="h-5 w-5" />Net Salary by Department</CardTitle></CardHeader>
            <CardContent>
              {deptSummary.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={deptSummary}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" fontSize={11} angle={-15} textAnchor="end" height={55} />
                    <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => `Rs. ${v.toLocaleString()}`} />
                    <Bar dataKey="net" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="h-[260px] flex items-center justify-center text-muted-foreground">No data</div>}
            </CardContent>
          </Card>

          {/* Advances Management */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Advances</CardTitle>
                <Button size="sm" disabled={isLocked && !isSuperAdmin} onClick={() => { setAdvEmployeeId(""); setAdvDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1" />Add
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {monthAdvances.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No advances this month</div>
              ) : (
                <div className="max-h-[220px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {monthAdvances.map((a: any) => {
                        const emp = employees?.find((e) => e.id === a.employee_id);
                        return (
                          <TableRow key={a.id}>
                            <TableCell className="text-sm">{emp?.full_name || "Unknown"}</TableCell>
                            <TableCell className="text-sm">{format(new Date(a.advance_date), "dd MMM")}</TableCell>
                            <TableCell className="text-right text-sm font-medium">Rs. {Number(a.amount).toLocaleString()}</TableCell>
                            <TableCell>
                              {!(isLocked && !isSuperAdmin) && (
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteAdvanceMutation.mutate(a.id)}>
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Overtime Management */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2"><Clock className="h-5 w-5" />Overtime</CardTitle>
                <Button size="sm" disabled={isLocked && !isSuperAdmin} onClick={() => { setOtEmployeeId(""); setOtDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1" />Add
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {monthOvertime.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No overtime this month</div>
              ) : (
                <div className="max-h-[220px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {monthOvertime.map((o: any) => {
                        const emp = employees?.find((e) => e.id === o.employee_id);
                        return (
                          <TableRow key={o.id}>
                            <TableCell className="text-sm">{emp?.full_name || "Unknown"}</TableCell>
                            <TableCell className="text-sm">{format(new Date(o.overtime_date), "dd MMM")}</TableCell>
                            <TableCell className="text-right text-sm font-medium">Rs. {Number(o.amount).toLocaleString()}</TableCell>
                            <TableCell>
                              {!(isLocked && !isSuperAdmin) && (
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteOvertimeMutation.mutate(o.id)}>
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Salary Table */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Salary Sheet - {MONTHS[selectedMonth]} {selectedYear}</CardTitle></CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead className="text-right">Basic</TableHead>
                    <TableHead className="text-right">Allowance</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-center">Present</TableHead>
                    <TableHead className="text-center">Half</TableHead>
                    <TableHead className="text-center">PL</TableHead>
                    <TableHead className="text-center">Paid S/PH</TableHead>
                    <TableHead className="text-center">Absent</TableHead>
                    <TableHead className="text-right">Earned</TableHead>
                    <TableHead className="text-right">Att. Allow</TableHead>
                    <TableHead className="text-right">Overtime</TableHead>
                    <TableHead className="text-right">Advance</TableHead>
                    <TableHead className="text-right">Loan EMI</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Net Salary</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={20} className="text-center py-8 text-muted-foreground">No employees found</TableCell></TableRow>
                  ) : (
                    filtered.map((e, i) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-mono text-xs">{e.employee_code}</TableCell>
                        <TableCell className="font-medium">{e.full_name}</TableCell>
                        <TableCell className="text-sm">{e.department}</TableCell>
                        <TableCell className="text-right text-sm">Rs. {e.basic_salary.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-sm">Rs. {e.allowances.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-sm">Rs. {e.gross.toLocaleString()}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-xs">{e.presentDays}</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {e.halfDays > 0 && <Badge variant="secondary" className="text-xs">{e.halfDays}</Badge>}
                        </TableCell>
                        <TableCell className="text-center">
                          {e.paidLeaveDays > 0 && <Badge variant="outline" className="text-xs text-green-600 border-green-300">{e.paidLeaveDays}</Badge>}
                        </TableCell>
                        <TableCell className="text-center">
                          {e.paidSundaysHolidays > 0 ? <Badge variant="outline" className="text-xs text-purple-600 border-purple-300">{e.paidSundaysHolidays}</Badge> : <span className="text-muted-foreground text-xs">0</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          {e.absentDays > 0 && <Badge variant="destructive" className="text-xs">{e.absentDays}</Badge>}
                        </TableCell>
                        <TableCell className="text-right text-sm">Rs. {e.earnedSalary.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-sm text-blue-600">
                          {e.attendanceAllowance > 0 ? `Rs. ${e.attendanceAllowance.toLocaleString()}` : "-"}
                        </TableCell>
                        <TableCell className="text-right text-sm text-green-600">
                          {e.overtimeAmount > 0 ? `Rs. ${e.overtimeAmount.toLocaleString()}` : "-"}
                        </TableCell>
                        <TableCell className="text-right text-sm text-destructive">
                          {e.advanceDeduction > 0 ? `Rs. ${e.advanceDeduction.toLocaleString()}` : "-"}
                        </TableCell>
                        <TableCell className="text-right text-sm text-destructive">
                          {e.loanDeduction > 0 ? `Rs. ${e.loanDeduction.toLocaleString()}` : "-"}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium text-destructive">
                          {e.totalDeduction > 0 ? `Rs. ${e.totalDeduction.toLocaleString()}` : "-"}
                        </TableCell>
                        <TableCell className="text-right font-semibold">Rs. {e.netSalary.toLocaleString()}</TableCell>
                        <TableCell>
                          <div className="flex gap-0.5">
                            {!(isLocked && !isSuperAdmin) && (
                              <>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleInlineAdvance(e.id)} title="Add Advance">
                                  <Plus className="h-3.5 w-3.5 text-orange-500" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleInlineOvertime(e.id)} title="Add Overtime">
                                  <Clock className="h-3.5 w-3.5 text-green-500" />
                                </Button>
                              </>
                            )}
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePrintPayslip(e)} title="Print Payslip">
                              <FileText className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
                {filtered.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={4} className="font-bold">Total ({totals.count}) — {workingDays} working days</TableCell>
                      <TableCell className="text-right font-bold">Rs. {totals.basic.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-bold">Rs. {totals.allowances.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-bold">Rs. {totals.gross.toLocaleString()}</TableCell>
                      <TableCell colSpan={5} />
                      <TableCell className="text-right font-bold">Rs. {totals.earned.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-bold text-blue-600">Rs. {totals.attAllowance.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-bold text-green-600">Rs. {totals.overtime.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-bold text-destructive">Rs. {totals.advances.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-bold text-destructive">Rs. {totals.loans.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-bold text-destructive">Rs. {totals.deductions.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-bold">Rs. {totals.net.toLocaleString()}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Advance Dialog */}
        <Dialog open={advDialogOpen} onOpenChange={setAdvDialogOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Advance</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Employee</Label>
                <Select value={advEmployeeId} onValueChange={setAdvEmployeeId}>
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {employees?.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.employee_code} - {e.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Amount (Rs.)</Label>
                <Input type="number" value={advAmount} onChange={(e) => setAdvAmount(e.target.value)} />
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" value={advDate} onChange={(e) => setAdvDate(e.target.value)} />
              </div>
              <div>
                <Label>Remarks</Label>
                <Textarea value={advRemarks} onChange={(e) => setAdvRemarks(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button onClick={() => addAdvanceMutation.mutate(undefined)} disabled={!advEmployeeId || !advAmount}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Overtime Dialog */}
        <Dialog open={otDialogOpen} onOpenChange={setOtDialogOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Overtime</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Employee</Label>
                <Select value={otEmployeeId} onValueChange={setOtEmployeeId}>
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {employees?.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.employee_code} - {e.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Hours</Label>
                  <Input type="number" step="0.5" value={otHours} onChange={(e) => setOtHours(e.target.value)} />
                </div>
                <div>
                  <Label>Amount (Rs.)</Label>
                  <Input type="number" value={otAmount} onChange={(e) => setOtAmount(e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" value={otDate} onChange={(e) => setOtDate(e.target.value)} />
              </div>
              <div>
                <Label>Remarks</Label>
                <Textarea value={otRemarks} onChange={(e) => setOtRemarks(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button onClick={() => addOvertimeMutation.mutate(undefined)} disabled={!otEmployeeId || !otAmount}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
