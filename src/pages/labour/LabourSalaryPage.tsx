import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, getDay, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, getDaysInMonth, subMonths } from "date-fns";
import { Search, Printer, Banknote, CalendarIcon, Clock, Download, Receipt, MapPin, Award, Lock, Unlock, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/shared/MetricCard";
import { PayslipDialog } from "@/components/labour/PayslipDialog";
import { AdvancePaymentDialog } from "@/components/labour/AdvancePaymentDialog";
import { TravelAdvanceDialog } from "@/components/labour/TravelAdvanceDialog";
import { AttendanceAllowanceDialog } from "@/components/labour/AttendanceAllowanceDialog";
import { OvertimeDialog } from "@/components/labour/OvertimeDialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Users, Wallet, TrendingUp, Calendar as CalendarLucide, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

interface LabourEmployee {
  id: string;
  employee_code: string;
  full_name: string;
  category: string | null;
  department_id: string | null;
  monthly_salary: number | null;
  is_active: boolean;
  employee_type: "salary" | "daily_wages";
  per_day_wages: number | null;
  attendance_allowance: number | null;
  production_departments?: { id: string; name: string } | null;
}

interface ProductivityEntry {
  id: string;
  employee_id: string;
  work_type: string;
  mph: number;
  target_date: string;
  overtime_amount: number | null;
}

const LabourSalaryPage = () => {
  const { hasRole, user } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const queryClient = useQueryClient();
  
  const [searchTerm, setSearchTerm] = useState("");
  const [filterDepartment, setFilterDepartment] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState(format(subMonths(new Date(), 1), "yyyy-MM"));
  const [selectedEmployee, setSelectedEmployee] = useState<typeof salaryData[0] | null>(null);
  const [payslipOpen, setPayslipOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceEmployee, setAdvanceEmployee] = useState<{ id: string; employee_code: string; full_name: string } | null>(null);
  const [overtimeOpen, setOvertimeOpen] = useState(false);
  const [overtimeEmployee, setOvertimeEmployee] = useState<{ id: string; employee_code: string; full_name: string } | null>(null);
  const [travelAdvanceOpen, setTravelAdvanceOpen] = useState(false);
  const [travelAdvanceEmployee, setTravelAdvanceEmployee] = useState<{ id: string; employee_code: string; full_name: string } | null>(null);
  const [attAllowanceOpen, setAttAllowanceOpen] = useState(false);
  const [attAllowanceEmployee, setAttAllowanceEmployee] = useState<{ id: string; employee_code: string; full_name: string } | null>(null);
  
  // Date range filter (super admin only)
  const [dateFilterEnabled, setDateFilterEnabled] = useState(false);
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);

  // Determine date range for queries
  const effectiveStartDate = isSuperAdmin && dateFilterEnabled && startDate 
    ? format(startDate, "yyyy-MM-dd") 
    : `${selectedMonth}-01`;
  const effectiveEndDate = isSuperAdmin && dateFilterEnabled && endDate 
    ? format(endDate, "yyyy-MM-dd") 
    : format(endOfMonth(parseISO(`${selectedMonth}-01`)), "yyyy-MM-dd");

  // Extend query range by 1 day before month start to check Saturday attendance for first Sunday
  const queryStartDate = (() => {
    const monthStart = parseISO(effectiveStartDate);
    const dayBefore = new Date(monthStart.getTime() - 24 * 60 * 60 * 1000);
    return format(dayBefore, "yyyy-MM-dd");
  })();

  // Extend query range by 1 day after month end to check Monday attendance for last Sunday
  const queryEndDate = (() => {
    const monthEndDate = parseISO(effectiveEndDate);
    const dayAfter = new Date(monthEndDate.getTime() + 24 * 60 * 60 * 1000);
    return format(dayAfter, "yyyy-MM-dd");
  })();

  // Derive month/year integers for salary lock
  const lockMonth = parseInt(selectedMonth.split("-")[1], 10);
  const lockYear = parseInt(selectedMonth.split("-")[0], 10);

  // Fetch public holidays from database
  const { data: publicHolidaysData = [] } = useQuery({
    queryKey: ["labour-public-holidays", effectiveStartDate, effectiveEndDate],
    queryFn: async () => {
      const { data } = await supabase
        .from("public_holidays" as any)
        .select("holiday_date")
        .eq("is_active", true)
        .gte("holiday_date", effectiveStartDate)
        .lte("holiday_date", effectiveEndDate);
      return ((data as any[]) || []).map((h: any) => h.holiday_date as string);
    },
  });

  // Check if this month is locked for labour
  const { data: salaryLock } = useQuery({
    queryKey: ["labour-salary-lock", lockMonth, lockYear],
    queryFn: async () => {
      const { data } = await supabase
        .from("salary_locks" as any)
        .select("*")
        .eq("module", "labour")
        .eq("lock_month", lockMonth)
        .eq("lock_year", lockYear)
        .maybeSingle();
      return data as any;
    },
  });

  const isLocked = !!salaryLock;
  const lockId = (salaryLock as any)?.id;

  // Load snapshots for locked months
  const { data: salarySnapshots = [] } = useQuery({
    queryKey: ["labour-salary-snapshots", lockId],
    queryFn: async () => {
      if (!lockId) return [];
      const { data } = await supabase
        .from("labour_salary_snapshots" as any)
        .select("*")
        .eq("lock_id", lockId);
      return (data || []) as any[];
    },
    enabled: !!lockId,
  });

  const lockSalaryMutation = useMutation({
    mutationFn: async () => {
      // First insert the lock record
      const { data: lockRecord, error } = await supabase.from("salary_locks" as any).insert({
        module: "labour",
        lock_month: lockMonth,
        lock_year: lockYear,
        locked_by: user?.id,
        total_net_salary: totalEarnedSalary,
        total_employees: totalEmployees,
      } as any).select().single();
      if (error) throw error;

      // Then save snapshots of all salary data
      const snapshots = filteredData.map((emp: any) => ({
        lock_id: (lockRecord as any).id,
        employee_id: emp.id,
        employee_code: emp.employee_code,
        full_name: emp.full_name,
        category: emp.category || null,
        department_name: emp.production_departments?.name || null,
        employee_type: emp.employee_type,
        monthly_salary: emp.monthly_salary || 0,
        per_day_wages: emp.per_day_wages || 0,
        full_days: emp.fullDays,
        half_days: emp.halfDays,
        paid_sundays: emp.paidSundays,
        absent_days: emp.absentDays,
        total_mph: emp.totalMph,
        gross_salary: emp.grossSalary,
        total_overtime: emp.totalOvertime,
        total_advance: emp.totalAdvance,
        total_travel_advance: emp.totalTravelAdvance,
        total_att_allowance: emp.totalAttAllowance,
        earned_salary: emp.earnedSalary,
        days_worked: emp.daysWorked,
      }));

      if (snapshots.length > 0) {
        const { error: snapError } = await supabase
          .from("labour_salary_snapshots" as any)
          .insert(snapshots as any);
        if (snapError) throw snapError;
      }
    },
    onSuccess: () => {
      toast.success(`Labour salary locked for ${format(parseISO(selectedMonth + "-01"), "MMMM yyyy")}`);
      queryClient.invalidateQueries({ queryKey: ["labour-salary-lock"] });
      queryClient.invalidateQueries({ queryKey: ["labour-salary-snapshots"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const unlockSalaryMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("salary_locks" as any)
        .delete()
        .eq("module", "labour")
        .eq("lock_month", lockMonth)
        .eq("lock_year", lockYear);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Labour salary unlocked for ${format(parseISO(selectedMonth + "-01"), "MMMM yyyy")}`);
      queryClient.invalidateQueries({ queryKey: ["labour-salary-lock"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["production-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true)
        .order("sequence_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["labour-employees-salary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labour_employees")
        .select(`
          *,
          production_departments(id, name)
        `)
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data as LabourEmployee[];
    },
  });

  // Get productivity entries for the selected date range
  const { data: productivityEntries = [], isLoading: isLoadingProductivity, isFetching: isFetchingProductivity } = useQuery({
    queryKey: ["labour-productivity-month", queryStartDate, queryEndDate],
    queryFn: async () => {
      console.log('Fetching productivity for:', queryStartDate, 'to', queryEndDate);
      // Important: backend defaults to 1000 rows per request.
      // Salary calculations require the full month range, so we paginate.
      const pageSize = 1000;
      const maxPages = 50; // safety guard

      const all: ProductivityEntry[] = [];

      for (let page = 0; page < maxPages; page++) {
        const from = page * pageSize;
        const to = from + pageSize - 1;

        const { data, error } = await supabase
          .from("labour_productivity_targets")
          .select("id, employee_id, work_type, mph, target_date, overtime_amount")
          .gte("target_date", queryStartDate)
          .lte("target_date", queryEndDate)
          .order("target_date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);

        if (error) { console.error('Productivity query error:', error); throw error; }

        const rows = (data || []) as ProductivityEntry[];
        all.push(...rows);

        if (rows.length < pageSize) break;
      }

      console.log('Fetched productivity entries:', all.length, 'for', effectiveStartDate);
      return all;
    },
    placeholderData: (previousData) => previousData,
  });

  // Get advances for the selected date range
  const { data: advances = [] } = useQuery({
    queryKey: ["labour-advances", effectiveStartDate, effectiveEndDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labour_advances")
        .select("id, employee_id, amount, advance_date");
      if (error) throw error;
      return (data || []).filter(a => a.advance_date >= effectiveStartDate && a.advance_date <= effectiveEndDate);
    },
    placeholderData: (previousData) => previousData,
  });

  // Get travel advances for the selected date range
  const { data: travelAdvances = [] } = useQuery({
    queryKey: ["labour-travel-advances", effectiveStartDate, effectiveEndDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labour_travel_advances")
        .select("id, employee_id, amount, advance_date");
      if (error) throw error;
      return (data || []).filter(a => a.advance_date >= effectiveStartDate && a.advance_date <= effectiveEndDate);
    },
    placeholderData: (previousData) => previousData,
  });

  // Get attendance allowances for the selected date range
  const { data: attAllowances = [] } = useQuery({
    queryKey: ["labour-attendance-allowances", effectiveStartDate, effectiveEndDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labour_attendance_allowances")
        .select("id, employee_id, amount, allowance_date");
      if (error) throw error;
      return (data || []).filter(a => a.allowance_date >= effectiveStartDate && a.allowance_date <= effectiveEndDate);
    },
    placeholderData: (previousData) => previousData,
  });

  // Public holidays fetched from database (treated like Sundays - paid if present on adjacent working days)
  const PUBLIC_HOLIDAYS = publicHolidaysData;

  // Helper: find nearest working day in a direction, skipping Sundays and public holidays
  const findAdjacentWorkingDay = (date: Date, direction: 'forward' | 'backward', holidaySet: Set<string>): Date => {
    const step = direction === 'forward' ? 1 : -1;
    let current = new Date(date.getTime() + step * 24 * 60 * 60 * 1000);
    let maxIterations = 10; // safety limit
    while (maxIterations-- > 0) {
      const dayOfWeek = getDay(current);
      const dateStr = format(current, 'yyyy-MM-dd');
      if (dayOfWeek !== 0 && !holidaySet.has(dateStr)) {
        return current;
      }
      current = new Date(current.getTime() + step * 24 * 60 * 60 * 1000);
    }
    return current;
  };

  // Helper function to calculate paid Sundays & public holidays based on adjacent working day attendance
  const calculatePaidSundays = (empEntries: ProductivityEntry[], monthStr: string) => {
    const monthStart = startOfMonth(parseISO(`${monthStr}-01`));
    const monthEnd = endOfMonth(monthStart);
    
    const holidaySet = new Set(PUBLIC_HOLIDAYS);
    
    // Create a set of dates the employee worked
    const workedDates = new Set(empEntries.map(e => e.target_date));
    
    let paidDays = 0;
    
    // Count paid Sundays
    const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
    allDays.forEach(day => {
      if (getDay(day) !== 0) return; // only Sundays
      
      const workDayBefore = findAdjacentWorkingDay(day, 'backward', holidaySet);
      const workDayAfter = findAdjacentWorkingDay(day, 'forward', holidaySet);
      
      if (workedDates.has(format(workDayBefore, 'yyyy-MM-dd')) && workedDates.has(format(workDayAfter, 'yyyy-MM-dd'))) {
        paidDays++;
      }
    });

    // Count paid public holidays (same policy: present on adjacent working days before AND after)
    PUBLIC_HOLIDAYS.forEach(holidayStr => {
      const holidayDate = parseISO(holidayStr);
      if (!isSameMonth(holidayDate, monthStart)) return;
      if (getDay(holidayDate) === 0) return; // already counted as Sunday
      
      const workDayBefore = findAdjacentWorkingDay(holidayDate, 'backward', holidaySet);
      const workDayAfter = findAdjacentWorkingDay(holidayDate, 'forward', holidaySet);
      
      if (workedDates.has(format(workDayBefore, 'yyyy-MM-dd')) && workedDates.has(format(workDayAfter, 'yyyy-MM-dd'))) {
        paidDays++;
      }
    });
    
    return paidDays;
  };

  // Calculate salary data for each employee
  const salaryData = employees.map((emp) => {
    // All entries including previous month's last day (for paid Sunday check)
    const allEmpEntries = productivityEntries.filter((e) => e.employee_id === emp.id);
    // Only entries within the actual month for salary calculations
    const empEntries = allEmpEntries.filter((e) => e.target_date >= effectiveStartDate && e.target_date <= effectiveEndDate);
    const totalMph = empEntries.reduce((sum, e) => sum + Number(e.mph || 0), 0);

    // Group half-day entries by date: two half-days on same date = one full day
    const halfDaysByDate = new Map<string, number>();
    let rawFullDays = 0;
    empEntries.forEach((e) => {
      if (e.work_type === "full_day") {
        rawFullDays++;
      } else if (e.work_type === "half_day") {
        halfDaysByDate.set(e.target_date, (halfDaysByDate.get(e.target_date) || 0) + 1);
      }
    });
    // Convert paired half-days into full days
    let mergedFullDays = 0;
    let remainingHalfDays = 0;
    halfDaysByDate.forEach((count) => {
      mergedFullDays += Math.floor(count / 2);
      remainingHalfDays += count % 2;
    });
    const fullDays = rawFullDays + mergedFullDays;
    const halfDays = remainingHalfDays;
    const daysWorked = fullDays + halfDays;
    
    // Calculate total overtime amount
    const totalOvertime = empEntries.reduce((sum, e) => sum + Number(e.overtime_amount || 0), 0);
    
    // Calculate daily rate based on employee type
    const referenceMonth = isSuperAdmin && dateFilterEnabled && startDate 
      ? format(startDate, "yyyy-MM") 
      : selectedMonth;
    const daysInMonth = getDaysInMonth(parseISO(`${referenceMonth}-01`));
    
    // For salary-based: monthly salary / days in month
    // For daily wages: use per_day_wages directly
    const isSalaryBased = emp.employee_type === "salary";
    const dailyRate = isSalaryBased 
      ? (emp.monthly_salary || 0) / daysInMonth 
      : (emp.per_day_wages || 0);
    
    // Calculate paid Sundays - only for salary-based employees
    const paidSundays = isSalaryBased ? calculatePaidSundays(allEmpEntries, referenceMonth) : 0;
    
    // Calculate total advances for this employee in selected date range
    const totalAdvance = advances
      .filter(a => a.employee_id === emp.id)
      .reduce((sum, a) => sum + Number(a.amount || 0), 0);
    
    // Calculate total travel advances
    const totalTravelAdvance = travelAdvances
      .filter(a => a.employee_id === emp.id)
      .reduce((sum, a) => sum + Number(a.amount || 0), 0);
    
    // Calculate absent days: total working days (excl Sundays & public holidays) - days worked
    const refMonthStart = startOfMonth(parseISO(`${referenceMonth}-01`));
    const refMonthEnd = endOfMonth(refMonthStart);
    const allDaysInMonth = eachDayOfInterval({ start: refMonthStart, end: refMonthEnd });
    const publicHolidaySet = new Set(PUBLIC_HOLIDAYS);
    const workingDaysInMonth = allDaysInMonth.filter(d => getDay(d) !== 0 && !publicHolidaySet.has(format(d, 'yyyy-MM-dd'))).length;
    const absentDays = Math.max(0, workingDaysInMonth - daysWorked);

    // Calculate total attendance allowances (manual entries)
    const manualAttAllowance = attAllowances
      .filter(a => a.employee_id === emp.id)
      .reduce((sum, a) => sum + Number(a.amount || 0), 0);
    
    // Auto-add attendance allowance if employee has 0 absent days and max 2 half days
    const autoAttAllowance = (absentDays === 0 && halfDays <= 2 && daysWorked > 0) 
      ? Number(emp.attendance_allowance || 0) 
      : 0;
    const totalAttAllowance = manualAttAllowance + autoAttAllowance;
    
    // Calculate earned salary based on days worked + paid Sundays (if salary-based) + overtime + attendance allowance
    const baseSalary = isSalaryBased
      ? (fullDays * dailyRate) + (halfDays * dailyRate * 0.5) + (paidSundays * dailyRate)
      : (fullDays * dailyRate) + (halfDays * dailyRate * 0.5);
    const grossSalary = baseSalary + totalOvertime + totalAttAllowance;
    const earnedSalary = grossSalary - totalAdvance - totalTravelAdvance;

    return {
      ...emp,
      totalMph,
      daysWorked,
      fullDays,
      halfDays,
      paidSundays,
      absentDays,
      dailyRate,
      totalAdvance,
      totalTravelAdvance,
      totalAttAllowance,
      totalOvertime,
      grossSalary,
      earnedSalary,
    };
  });

  // When locked and snapshots exist, use snapshot data instead of live calculations
  const useSnapshots = isLocked && salarySnapshots.length > 0;

  const snapshotData = useSnapshots ? salarySnapshots.map((s: any) => ({
    id: s.employee_id,
    employee_code: s.employee_code,
    full_name: s.full_name,
    category: s.category,
    department_id: null,
    production_departments: s.department_name ? { name: s.department_name } : null,
    employee_type: s.employee_type,
    monthly_salary: Number(s.monthly_salary || 0),
    per_day_wages: Number(s.per_day_wages || 0),
    is_active: true,
    totalMph: Number(s.total_mph || 0),
    daysWorked: Number(s.days_worked || 0),
    fullDays: Number(s.full_days || 0),
    halfDays: Number(s.half_days || 0),
    paidSundays: Number(s.paid_sundays || 0),
    absentDays: Number(s.absent_days || 0),
    dailyRate: 0,
    totalAdvance: Number(s.total_advance || 0),
    totalTravelAdvance: Number(s.total_travel_advance || 0),
    totalAttAllowance: Number(s.total_att_allowance || 0),
    totalOvertime: Number(s.total_overtime || 0),
    grossSalary: Number(s.gross_salary || 0),
    earnedSalary: Number(s.earned_salary || 0),
  })) : [];

  const displayData = useSnapshots ? snapshotData : salaryData;

  const filteredData = displayData.filter((emp: any) => {
    const matchesSearch = 
      emp.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.employee_code.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDept = filterDepartment === "all" || emp.department_id === filterDepartment || 
      (useSnapshots && filterDepartment === "all"); // snapshots don't have department_id
    return matchesSearch && matchesDept;
  }).sort((a: any, b: any) => {
    const rateA = a.employee_type === 'salary' ? (a.monthly_salary || 0) : (a.per_day_wages || 0);
    const rateB = b.employee_type === 'salary' ? (b.monthly_salary || 0) : (b.per_day_wages || 0);
    return rateB - rateA;
  });

  // Summary metrics
  const totalEmployees = filteredData.length;
  const totalMonthlySalary = filteredData.reduce((sum, e) => sum + (e.monthly_salary || 0), 0);
  const totalEarnedSalary = filteredData.reduce((sum, e) => sum + e.earnedSalary, 0);
  const totalMph = filteredData.reduce((sum, e) => sum + e.totalMph, 0);
  const totalAdvances = filteredData.reduce((sum, e) => sum + e.totalAdvance, 0);
  const totalTravelAdvances = filteredData.reduce((sum, e) => sum + e.totalTravelAdvance, 0);
  const totalOvertime = filteredData.reduce((sum, e) => sum + e.totalOvertime, 0);
  const totalPaidSundays = filteredData.reduce((sum, e) => sum + e.paidSundays, 0);

  const handlePrintAll = () => {
    if (filteredData.length === 0) return;
    
    const monthDisplay = format(new Date(`${selectedMonth}-01`), "MMMM yyyy");
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const payslipsHtml = filteredData.map(emp => {
      const departmentName = emp.production_departments?.name || '-';
      return `
        <div class="payslip">
          <div class="header">
            <h1>PAYSLIP - ${monthDisplay.toUpperCase()}</h1>
          </div>
          <div class="employee-info">
            <div class="info-group"><label>CODE</label><span>${emp.employee_code}</span></div>
            <div class="info-group"><label>NAME</label><span>${emp.full_name}</span></div>
            <div class="info-group"><label>DEPARTMENT</label><span>${departmentName}</span></div>
            <div class="info-group"><label>DAYS WORKED</label><span>${emp.daysWorked}</span></div>
          </div>
          <div class="content-row">
            <div class="earnings-section">
              <table class="earnings-table">
                <thead><tr><th>Description</th><th>Details</th><th>Amount (Rs.)</th></tr></thead>
                <tbody>
                  <tr><td>Monthly Salary</td><td>Base</td><td>${(emp.monthly_salary || 0).toLocaleString()}</td></tr>
                  <tr><td>Full Days (${emp.fullDays})</td><td>@ Rs.${emp.dailyRate.toFixed(0)}</td><td>${(emp.fullDays * emp.dailyRate).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>
                  <tr><td>Half Days (${emp.halfDays})</td><td>@ 50%</td><td>${(emp.halfDays * emp.dailyRate * 0.5).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>
                  <tr><td>Paid Sundays (${emp.paidSundays})</td><td></td><td>${(emp.paidSundays * emp.dailyRate).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>
                  <tr class="green"><td>Overtime</td><td></td><td>+${emp.totalOvertime.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>
                  <tr class="green"><td>Att. Allowance</td><td></td><td>+${emp.totalAttAllowance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>
                  <tr><td><strong>Gross</strong></td><td></td><td><strong>${emp.grossSalary.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></td></tr>
                  <tr class="red"><td>Less: Advance</td><td></td><td>-${emp.totalAdvance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>
                  <tr class="red"><td>Less: Travel Advance</td><td></td><td>-${emp.totalTravelAdvance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>
                  <tr class="total-row"><td colspan="2"><strong>NET PAYABLE</strong></td><td><strong>Rs. ${emp.earnedSalary.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="signature-section">
            <div class="signature-box"><div class="signature-line">Employee Signature</div></div>
            <div class="signature-box"><div class="signature-line">Authorized Signature</div></div>
          </div>
        </div>`;
    }).join('');

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Payslips - ${monthDisplay}</title><style>
      @page { size: 21.5cm 9.5cm; margin: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: Arial, sans-serif; font-size: 9px; }
      .payslip { width: 21.5cm; height: 9.5cm; padding: 6mm 8mm; display: flex; flex-direction: column; page-break-after: always; }
      .payslip:last-child { page-break-after: auto; }
      .header { text-align: center; border-bottom: 1px solid #000; padding-bottom: 3mm; margin-bottom: 3mm; }
      .header h1 { font-size: 12px; font-weight: bold; }
      .employee-info { display: flex; justify-content: space-between; margin-bottom: 3mm; padding: 2mm 3mm; background: #f0f0f0; border: 1px solid #ccc; }
      .info-group label { font-weight: bold; display: block; font-size: 7px; color: #555; }
      .info-group span { font-size: 9px; font-weight: 600; }
      .content-row { display: flex; gap: 4mm; flex: 1; }
      .earnings-section { flex: 1; }
      .earnings-table { width: 100%; border-collapse: collapse; font-size: 8px; }
      .earnings-table th, .earnings-table td { border: 1px solid #ccc; padding: 1.5mm 2mm; text-align: left; }
      .earnings-table th { background: #e8e8e8; font-weight: bold; font-size: 7px; }
      .earnings-table td:last-child { text-align: right; white-space: nowrap; }
      .total-row { font-weight: bold; background: #d4edda; }
      .total-row td { font-size: 10px; padding: 2mm !important; }
      .green { color: #16a34a; }
      .red { color: #dc2626; }
      .signature-section { display: flex; justify-content: space-between; margin-top: 3mm; padding-top: 2mm; }
      .signature-box { text-align: center; font-size: 7px; }
      .signature-line { width: 35mm; border-top: 1px solid #000; padding-top: 1mm; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style></head><body>${payslipsHtml}</body></html>`);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
  };

  const handlePrintSalaryList = () => {
    if (filteredData.length === 0) return;
    const monthDisplay = format(new Date(`${selectedMonth}-01`), "MMMM yyyy");
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const rows = filteredData.map((emp, i) => `<tr><td>${i + 1}</td><td>${emp.employee_code}</td><td>${emp.full_name}</td><td>${emp.production_departments?.name || '-'}</td><td>${emp.employee_type === 'salary' ? 'Salary' : 'Daily'}</td><td class="right">${emp.employee_type === 'salary' ? (emp.monthly_salary || 0).toLocaleString() : (emp.per_day_wages || 0).toLocaleString()}</td><td class="center">${emp.fullDays}</td><td class="center">${emp.halfDays}</td><td class="center">${emp.paidSundays}</td><td class="right">${emp.totalOvertime.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td><td class="right">${emp.grossSalary.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td><td class="right red">${emp.totalAdvance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td><td class="right bold">${emp.earnedSalary.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td><td></td></tr>`).join('');
    const totals = filteredData.reduce((acc, e) => ({ overtime: acc.overtime + e.totalOvertime, gross: acc.gross + e.grossSalary, advance: acc.advance + e.totalAdvance, net: acc.net + e.earnedSalary }), { overtime: 0, gross: 0, advance: 0, net: 0 });
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Salary List - ${monthDisplay}</title><style>@page{size:landscape;margin:10mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:10px;padding:5mm}h1{text-align:center;font-size:14px;margin-bottom:2mm}h2{text-align:center;font-size:11px;font-weight:normal;color:#555;margin-bottom:5mm}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:2mm 2.5mm;text-align:left;font-size:9px}th{background:#e8e8e8;font-weight:bold;font-size:8px;text-transform:uppercase}.right{text-align:right}.center{text-align:center}.bold{font-weight:bold}.red{color:#dc2626}.total-row{background:#d4edda;font-weight:bold;font-size:10px}.total-row td{padding:3mm 2.5mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><h1>SALARY LIST</h1><h2>${monthDisplay.toUpperCase()}${filterDepartment !== 'all' ? ' — ' + (departments.find(d => d.id === filterDepartment)?.name || '') : ''}</h2><table><thead><tr><th>#</th><th>Code</th><th>Name</th><th>Dept</th><th>Type</th><th>Rate</th><th>Full</th><th>Half</th><th>Sun</th><th>OT</th><th>Gross</th><th>Advance</th><th>Net Payable</th><th>Signature</th></tr></thead><tbody>${rows}<tr class="total-row"><td colspan="9" class="right">TOTALS</td><td class="right">${totals.overtime.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td><td class="right">${totals.gross.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td><td class="right red">${totals.advance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td><td class="right">${totals.net.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td><td></td></tr></tbody></table></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
  };

  const handleExportSalaryListExcel = async () => {
    if (filteredData.length === 0) return;
    const XLSX = await import("xlsx");
    const monthDisplay = format(new Date(`${selectedMonth}-01`), "MMMM yyyy");

    const headers = ["#", "Code", "Name", "Dept", "Category", "Type", "Rate", "Present", "Absent", "Full Days", "Half Days", "Paid Sundays", "Total MPH", "Overtime", "Att. Allowance", "Gross Salary", "Advance", "Travel Adv.", "Net Payable"];
    const rows = filteredData.map((emp, i) => [
      i + 1,
      emp.employee_code,
      emp.full_name,
      emp.production_departments?.name || '-',
      emp.category || '-',
      emp.employee_type === 'salary' ? 'Salary' : 'Daily',
      emp.employee_type === 'salary' ? (emp.monthly_salary || 0) : (emp.per_day_wages || 0),
      emp.daysWorked,
      emp.absentDays,
      emp.fullDays,
      emp.halfDays,
      emp.paidSundays,
      emp.totalMph,
      Math.round(emp.totalOvertime),
      Math.round(emp.totalAttAllowance),
      Math.round(emp.grossSalary),
      Math.round(emp.totalAdvance),
      Math.round(emp.totalTravelAdvance),
      Math.round(emp.earnedSalary),
    ]);

    const totals = filteredData.reduce((acc, e) => ({
      overtime: acc.overtime + e.totalOvertime,
      attAllow: acc.attAllow + e.totalAttAllowance,
      gross: acc.gross + e.grossSalary,
      advance: acc.advance + e.totalAdvance,
      travelAdv: acc.travelAdv + e.totalTravelAdvance,
      net: acc.net + e.earnedSalary,
    }), { overtime: 0, attAllow: 0, gross: 0, advance: 0, travelAdv: 0, net: 0 });

    rows.push(["", "", "", "", "", "", "", "", "", "", "", "", "TOTALS", Math.round(totals.overtime), Math.round(totals.attAllow), Math.round(totals.gross), Math.round(totals.advance), Math.round(totals.travelAdv), Math.round(totals.net)]);

    const wsData = [
      [`Salary List - ${monthDisplay}`],
      [],
      headers,
      ...rows,
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    ws["!cols"] = [
      { wch: 4 }, { wch: 8 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 7 }, { wch: 10 },
      { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 10 },
      { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
    ];

    // Merge title row
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Salary List");
    XLSX.writeFile(wb, `Salary-List-${monthDisplay.replace(' ', '-')}.xlsx`);
  };

  const handlePrintPaymentVouchers = () => {
    const voucherData = filteredData.filter(emp => Math.round(emp.earnedSalary) > 0);
    if (voucherData.length === 0) return;
    
    const monthDisplay = format(new Date(`${selectedMonth}-01`), "MMMM yyyy");
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const voucherBlocks = voucherData.map((emp, idx) => {
      const departmentName = emp.production_departments?.name || '-';
      return `
        <div class="voucher">
          <div class="voucher-header">
            <h1>SALARY PAYMENT VOUCHER - ${monthDisplay.toUpperCase()}</h1>
            <div class="voucher-meta">
              <div><label>Voucher No:</label> <span>SPV-${(idx + 1).toString().padStart(3, '0')}</span></div>
            </div>
          </div>
          <div class="employee-info">
            <div class="info-group"><label>CODE</label><span>${emp.employee_code}</span></div>
            <div class="info-group"><label>NAME</label><span>${emp.full_name}</span></div>
            <div class="info-group"><label>DEPARTMENT</label><span>${departmentName}</span></div>
            <div class="info-group"><label>DAYS WORKED</label><span>${emp.daysWorked}</span></div>
          </div>
          <table class="earnings-table">
            <thead><tr><th>Description</th><th>Details</th><th>Amount (Rs.)</th></tr></thead>
            <tbody>
              <tr><td>Monthly Salary</td><td>Base</td><td>${(emp.monthly_salary || emp.per_day_wages || 0).toLocaleString()}</td></tr>
              <tr><td>Full Days (${emp.fullDays})</td><td>@ Rs.${emp.dailyRate.toFixed(0)}</td><td>${(emp.fullDays * emp.dailyRate).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>
              <tr><td>Half Days (${emp.halfDays})</td><td>@ 50%</td><td>${(emp.halfDays * emp.dailyRate * 0.5).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>
              <tr><td>Paid Sundays (${emp.paidSundays})</td><td></td><td>${(emp.paidSundays * emp.dailyRate).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>
              ${emp.totalOvertime > 0 ? `<tr class="green"><td>Overtime</td><td></td><td>+${emp.totalOvertime.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>` : ''}
              ${emp.totalAttAllowance > 0 ? `<tr class="green"><td>Att. Allowance</td><td></td><td>+${emp.totalAttAllowance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>` : ''}
              <tr class="gross-row"><td><strong>Gross</strong></td><td></td><td><strong>${emp.grossSalary.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></td></tr>
              ${emp.totalAdvance > 0 ? `<tr class="red"><td>Less: Advance</td><td></td><td>-${emp.totalAdvance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>` : ''}
              ${emp.totalTravelAdvance > 0 ? `<tr class="red"><td>Less: Travel Advance</td><td></td><td>-${emp.totalTravelAdvance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>` : ''}
              <tr class="net-row"><td colspan="2"><strong>NET PAYABLE</strong></td><td><strong>Rs. ${emp.earnedSalary.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></td></tr>
            </tbody>
          </table>
          <div class="signature-section">
            <div class="sig-box"><div class="sig-line">Employee Signature</div></div>
            <div class="sig-box"><div class="sig-line">Authorized Signature</div></div>
          </div>
        </div>`;
    });

    // Group into pages of 3
    let pagesHtml = '';
    for (let i = 0; i < voucherBlocks.length; i += 3) {
      const chunk = voucherBlocks.slice(i, i + 3);
      pagesHtml += `<div class="page">${chunk.join('')}</div>`;
    }

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Payment Vouchers - ${monthDisplay}</title><style>
      @page { size: A4 portrait; margin: 5mm 8mm; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: Arial, sans-serif; font-size: 9px; }
      .page { width: 100%; height: 287mm; display: flex; flex-direction: column; page-break-after: always; }
      .page:last-child { page-break-after: auto; }
      .voucher { flex: 1; padding: 4mm 3mm; border-bottom: 1px dashed #999; display: flex; flex-direction: column; overflow: hidden; }
      .voucher:last-child { border-bottom: none; }
      .voucher-header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 1.5mm; margin-bottom: 2mm; }
      .voucher-header h1 { font-size: 11px; letter-spacing: 1px; font-weight: bold; }
      .voucher-meta { display: flex; justify-content: flex-end; font-size: 8px; margin-top: 1mm; }
      .voucher-meta label { font-weight: bold; }
      .employee-info { display: flex; justify-content: space-between; margin-bottom: 2mm; padding: 2mm 3mm; background: #f0f0f0; border: 1px solid #ccc; }
      .info-group label { font-weight: bold; display: block; font-size: 7px; color: #555; }
      .info-group span { font-size: 9px; font-weight: 600; }
      .earnings-table { width: 100%; border-collapse: collapse; font-size: 8px; flex: 1; }
      .earnings-table th, .earnings-table td { border: 1px solid #ccc; padding: 1.2mm 2mm; text-align: left; }
      .earnings-table th { background: #e8e8e8; font-weight: bold; font-size: 7px; }
      .earnings-table td:last-child { text-align: right; white-space: nowrap; }
      .gross-row { background: #f0f0f0; }
      .green td { color: #16a34a; }
      .red td { color: #dc2626; }
      .net-row { font-weight: bold; background: #d4edda; }
      .net-row td { font-size: 10px; padding: 1.5mm 2mm !important; }
      .signature-section { display: flex; justify-content: space-between; margin-top: 3mm; }
      .sig-box { text-align: center; }
      .sig-line { width: 40mm; border-top: 1px solid #000; padding-top: 1mm; font-size: 7px; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style></head><body>${pagesHtml}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
  };

  const columns: Column<typeof salaryData[0]>[] = [
    {
      key: "employee_code",
      header: "Code",
      render: (item) => <span className="font-medium">{item.employee_code}</span>,
    },
    {
      key: "full_name",
      header: "Name",
    },
    {
      key: "category",
      header: "Category",
      render: (item) => (
        <Badge variant="outline">{item.category || "-"}</Badge>
      ),
    },
    {
      key: "department",
      header: "Department",
      render: (item) => item.production_departments?.name || "-",
    },
    {
      key: "type",
      header: "Type",
      render: (item) => (
        <Badge variant={item.employee_type === "salary" ? "default" : "outline"}>
          {item.employee_type === "salary" ? "Salary" : "Daily"}
        </Badge>
      ),
    },
    {
      key: "rate",
      header: "Rate",
      render: (item) => (
        <span className="font-medium">
          {item.employee_type === "salary" 
            ? `Rs. ${(item.monthly_salary || 0).toLocaleString()}/mo`
            : `Rs. ${(item.per_day_wages || 0).toLocaleString()}/day`
          }
        </span>
      ),
    },
    {
      key: "days_worked",
      header: "Days Worked",
      render: (item) => (
        <div className="text-sm">
          <span className="font-medium">{item.daysWorked}</span>
          <span className="text-muted-foreground ml-1">
            ({item.fullDays}F + {item.halfDays}H)
          </span>
        </div>
      ),
    },
    {
      key: "present_days",
      header: "Present",
      render: (item) => (
        <Badge variant={item.daysWorked > 0 ? "outline" : "secondary"}>
          {item.daysWorked}
        </Badge>
      ),
    },
    {
      key: "paid_sundays",
      header: "Paid Sundays",
      render: (item) => (
        <Badge variant={item.paidSundays > 0 ? "outline" : "secondary"}>
          {item.paidSundays}
        </Badge>
      ),
    },
    {
      key: "absent_days",
      header: "Absent Days",
      render: (item) => (
        <Badge variant={item.absentDays > 0 ? "destructive" : "secondary"}>
          {item.absentDays}
        </Badge>
      ),
    },
    {
      key: "total_mph",
      header: "Total MPH",
      render: (item) => <span className="font-medium">{item.totalMph}</span>,
    },
    {
      key: "overtime",
      header: "Overtime",
      render: (item) => (
        <div className="flex items-center gap-1">
          <span className={item.totalOvertime > 0 ? "font-medium text-primary" : "text-muted-foreground"}>
            Rs. {item.totalOvertime.toLocaleString()}
          </span>
          {(!isLocked || isSuperAdmin) && (
            <Button 
              variant="ghost" 
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => {
                setOvertimeEmployee({ id: item.id, employee_code: item.employee_code, full_name: item.full_name });
                setOvertimeOpen(true);
              }}
            >
              <Clock className="h-3 w-3" />
            </Button>
          )}
        </div>
      ),
    },
    {
      key: "advance",
      header: "Advance",
      render: (item) => (
        <div className="flex items-center gap-1">
          <span className={item.totalAdvance > 0 ? "text-destructive font-medium" : "text-muted-foreground"}>
            Rs. {item.totalAdvance.toLocaleString()}
          </span>
          {(!isLocked || isSuperAdmin) && (
            <Button 
              variant="ghost" 
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => {
                setAdvanceEmployee({ id: item.id, employee_code: item.employee_code, full_name: item.full_name });
                setAdvanceOpen(true);
              }}
            >
              <Banknote className="h-3 w-3" />
            </Button>
          )}
        </div>
      ),
    },
    {
      key: "travel_advance",
      header: "Travel Adv.",
      render: (item) => (
        <div className="flex items-center gap-1">
          <span className={item.totalTravelAdvance > 0 ? "text-destructive font-medium" : "text-muted-foreground"}>
            Rs. {item.totalTravelAdvance.toLocaleString()}
          </span>
          {(!isLocked || isSuperAdmin) && (
            <Button 
              variant="ghost" 
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => {
                setTravelAdvanceEmployee({ id: item.id, employee_code: item.employee_code, full_name: item.full_name });
                setTravelAdvanceOpen(true);
              }}
            >
              <MapPin className="h-3 w-3" />
            </Button>
          )}
        </div>
      ),
    },
    {
      key: "att_allowance",
      header: "Att. Allow.",
      render: (item) => (
        <div className="flex items-center gap-1">
          <span className={item.totalAttAllowance > 0 ? "font-medium text-emerald-600" : "text-muted-foreground"}>
            Rs. {item.totalAttAllowance.toLocaleString()}
          </span>
          {(!isLocked || isSuperAdmin) && (
            <Button 
              variant="ghost" 
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => {
                setAttAllowanceEmployee({ id: item.id, employee_code: item.employee_code, full_name: item.full_name });
                setAttAllowanceOpen(true);
              }}
            >
              <Award className="h-3 w-3" />
            </Button>
          )}
        </div>
      ),
    },
    {
      key: "earned_salary",
      header: "Net Salary",
      render: (item) => (
        <Badge variant={item.earnedSalary > 0 ? "default" : "secondary"}>
          Rs. {item.earnedSalary.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "Payslip",
      render: (item) => (
        <Button 
          variant="ghost" 
          size="sm"
          onClick={() => {
            setSelectedEmployee(item);
            setPayslipOpen(true);
          }}
        >
          <Printer className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Labour Salary"
        description="View monthly salary calculations based on productivity"
      />

      {/* Salary Lock Banner */}
      {isLocked && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
          <ShieldAlert className="h-5 w-5 text-destructive" />
          <span className="font-medium text-destructive">
            Labour salary is locked for {format(parseISO(selectedMonth + "-01"), "MMMM yyyy")}. No modifications allowed.
          </span>
          {isSuperAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => unlockSalaryMutation.mutate()}
              disabled={unlockSalaryMutation.isPending}
            >
              <Unlock className="h-4 w-4 mr-2" />
              Unlock Salary
            </Button>
          )}
        </div>
      )}

      {/* Lock Button for Super Admin */}
      {isSuperAdmin && !isLocked && filteredData.length > 0 && (
        <div className="mb-4 flex justify-end">
          <Button
            variant="default"
            onClick={() => lockSalaryMutation.mutate()}
            disabled={lockSalaryMutation.isPending}
          >
            <Lock className="h-4 w-4 mr-2" />
            Lock Salary
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-6">
        <MetricCard
          title="Total Employees"
          value={totalEmployees}
          icon={Users}
        />
        <MetricCard
          title="Total Monthly Salary"
          value={`Rs. ${totalMonthlySalary.toLocaleString()}`}
          icon={Wallet}
        />
        <MetricCard
          title="Total Overtime"
          value={`Rs. ${totalOvertime.toLocaleString()}`}
          icon={Clock}
        />
        <MetricCard
          title="Total Advances"
          value={`Rs. ${totalAdvances.toLocaleString()}`}
          icon={CreditCard}
        />
        <MetricCard
          title="Travel Allowance"
          value={`Rs. ${totalTravelAdvances.toLocaleString()}`}
          icon={MapPin}
        />
        <MetricCard
          title="Net Payable"
          value={`Rs. ${totalEarnedSalary.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          icon={TrendingUp}
        />
        <MetricCard
          title="Paid Sundays"
          value={totalPaidSundays}
          icon={CalendarLucide}
        />
        <MetricCard
          title="Total MPH"
          value={totalMph}
          icon={Clock}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search employee..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 w-[250px]"
          />
        </div>
        
        {/* Date Range Filter - Super Admin Only */}
        {isSuperAdmin && (
          <div className="flex items-center gap-2 border rounded-lg px-3 py-1 bg-muted/30">
            <input
              type="checkbox"
              id="dateFilter"
              checked={dateFilterEnabled}
              onChange={(e) => {
                setDateFilterEnabled(e.target.checked);
                if (!e.target.checked) {
                  setStartDate(undefined);
                  setEndDate(undefined);
                }
              }}
              className="h-4 w-4 rounded border-primary"
            />
            <label htmlFor="dateFilter" className="text-sm font-medium cursor-pointer">
              Date Range
            </label>
            
            {dateFilterEnabled && (
              <>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "w-[130px] justify-start text-left font-normal",
                        !startDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {startDate ? format(startDate, "dd-MMM-yy") : "Start"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={startDate}
                      onSelect={setStartDate}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
                <span className="text-muted-foreground">to</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "w-[130px] justify-start text-left font-normal",
                        !endDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {endDate ? format(endDate, "dd-MMM-yy") : "End"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={endDate}
                      onSelect={setEndDate}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </>
            )}
          </div>
        )}
        
        {/* Month filter - hidden when date range is enabled */}
        {(!isSuperAdmin || !dateFilterEnabled) && (
          <Input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-[180px]"
          />
        )}
        
        <Select value={filterDepartment} onValueChange={setFilterDepartment}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map((dept) => (
              <SelectItem key={dept.id} value={dept.id}>
                {dept.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          onClick={() => handlePrintAll()}
          disabled={filteredData.length === 0}
        >
          <Printer className="h-4 w-4 mr-2" />
          Print All Payslips
        </Button>

        <Button
          variant="outline"
          onClick={() => handleExportSalaryListExcel()}
          disabled={filteredData.length === 0}
        >
          <Download className="h-4 w-4 mr-2" />
          Export Salary List
        </Button>

        <Button
          variant="outline"
          onClick={() => handlePrintSalaryList()}
          disabled={filteredData.length === 0}
        >
          <Printer className="h-4 w-4 mr-2" />
          Print Salary List
        </Button>

        <Button
          variant="outline"
          onClick={() => handlePrintPaymentVouchers()}
          disabled={filteredData.filter(e => Math.round(e.earnedSalary) > 0).length === 0}
        >
          <Receipt className="h-4 w-4 mr-2" />
          Print Payment Vouchers
        </Button>
      </div>

      <div className="overflow-x-auto">
        {isFetchingProductivity && (
          <div className="text-center py-2 text-sm text-muted-foreground animate-pulse">
            Loading salary data...
          </div>
        )}
        <DataTable 
          columns={columns} 
          data={filteredData} 
          emptyMessage="No salary data found" 
        />
      </div>

      <PayslipDialog
        open={payslipOpen}
        onOpenChange={setPayslipOpen}
        employee={selectedEmployee}
        month={selectedMonth}
      />

      <AdvancePaymentDialog
        open={advanceOpen}
        onOpenChange={setAdvanceOpen}
        employee={advanceEmployee}
        month={selectedMonth}
      />

      <OvertimeDialog
        open={overtimeOpen}
        onOpenChange={setOvertimeOpen}
        employee={overtimeEmployee}
        month={selectedMonth}
      />

      <TravelAdvanceDialog
        open={travelAdvanceOpen}
        onOpenChange={setTravelAdvanceOpen}
        employee={travelAdvanceEmployee}
        month={selectedMonth}
      />

      <AttendanceAllowanceDialog
        open={attAllowanceOpen}
        onOpenChange={setAttAllowanceOpen}
        employee={attAllowanceEmployee}
        month={selectedMonth}
      />
    </ERPLayout>
  );
};

export default LabourSalaryPage;
