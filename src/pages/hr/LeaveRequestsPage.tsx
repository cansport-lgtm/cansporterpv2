import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, CalendarIcon, MoreHorizontal, Check, X, Eye, Users, CalendarDays, AlertTriangle, Pencil, RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

interface LeaveFormData {
  employee_id: string;
  leave_type_id: string;
  start_date: Date | undefined;
  end_date: Date | undefined;
  reason: string;
}

export default function LeaveRequestsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showDialog, setShowDialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [editQuotaEmployee, setEditQuotaEmployee] = useState<any>(null);
  const [editQuotaValue, setEditQuotaValue] = useState("");
  const [editHalfDayQuotaEmployee, setEditHalfDayQuotaEmployee] = useState<any>(null);
  const [editHalfDayQuotaValue, setEditHalfDayQuotaValue] = useState("");
  const [formData, setFormData] = useState<LeaveFormData>({
    employee_id: "",
    leave_type_id: "",
    start_date: undefined,
    end_date: undefined,
    reason: "",
  });

  const isSuperAdmin = user?.user_id === "admin";

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  // Fetch employees with annual_leaves
  const { data: employees = [] } = useQuery({
    queryKey: ["employees-active-leaves"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_code, full_name, annual_leaves, half_day_leaves, leave_quota_type, production_departments(name)")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data as any[];
    },
  });

  // Fetch leave types
  const { data: leaveTypes = [] } = useQuery({
    queryKey: ["leave-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_types")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch leave balances for selected year
  const { data: leaveBalances = [] } = useQuery({
    queryKey: ["leave-balances", selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_leave_balances" as any)
        .select("*")
        .eq("year", selectedYear);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  // Fetch leave requests
  const { data: leaveRequests = [], isLoading } = useQuery({
    queryKey: ["leave-requests", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("leave_requests")
        .select("*, employees(employee_code, full_name), leave_types(code, name, is_paid), app_users!leave_requests_approved_by_fkey(full_name)")
        .order("applied_at", { ascending: false });
      
      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Dynamic quota calculation: 1 leave per month, based on current month
  const getMonthlyQuota = useCallback((_quotaType?: string) => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const monthsElapsed = selectedYear === currentYear ? currentMonth : 12;
    return monthsElapsed;
  }, [selectedYear, currentYear]);

  // Build balance map: employee_id -> { total_allocated, total_used, remaining }
  const balanceMap = useMemo(() => {
    const map: Record<string, { total_allocated: number; total_used: number; remaining: number; half_day_allocated: number; half_day_used: number; half_day_remaining: number }> = {};
    
    employees.forEach((emp) => {
      const quotaType = (emp as any).leave_quota_type || 'half_day';
      const monthlyQuota = getMonthlyQuota(quotaType);
      
      // Dynamic allocation based on quota type
      const dynamicFullDay = quotaType === 'full_day' ? monthlyQuota : 0;
      const dynamicHalfDay = quotaType === 'half_day' ? monthlyQuota : 0;
      
      // Check if balance record exists
      const existing = leaveBalances.find((b: any) => b.employee_id === emp.id);
      
      if (existing) {
        const used = Number((existing as any).total_used);
        const hdUsed = Number((existing as any).half_day_used ?? 0);
        // Use DB values as source of truth (admin may have manually overridden)
        const dbFullDay = Number((existing as any).total_allocated);
        const dbHalfDay = Number((existing as any).half_day_allocated ?? 0);
        const effectiveFullDay = quotaType === 'full_day' ? (dbFullDay > 0 ? dbFullDay : dynamicFullDay) : 0;
        const effectiveHalfDay = quotaType === 'half_day' ? (dbHalfDay > 0 ? dbHalfDay : dynamicHalfDay) : 0;
        map[emp.id] = {
          total_allocated: effectiveFullDay,
          total_used: used,
          remaining: effectiveFullDay - used,
          half_day_allocated: effectiveHalfDay,
          half_day_used: hdUsed,
          half_day_remaining: effectiveHalfDay - hdUsed,
        };
      } else {
        map[emp.id] = {
          total_allocated: dynamicFullDay,
          total_used: 0,
          remaining: dynamicFullDay,
          half_day_allocated: dynamicHalfDay,
          half_day_used: 0,
          half_day_remaining: dynamicHalfDay,
        };
      }
    });
    return map;
  }, [leaveBalances, employees, getMonthlyQuota]);

  // Upsert leave balance helper — routes deduction to correct bucket based on quota type
  const upsertLeaveBalance = async (employeeId: string, year: number, usedDelta: number) => {
    const emp = employees.find((e) => e.id === employeeId);
    const quotaType = (emp as any)?.leave_quota_type || 'half_day';
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const monthsElapsed = year === currentYear ? currentMonth : 12;
    const dynamicFullDay = quotaType === 'full_day' ? monthsElapsed : 0;
    const dynamicHalfDay = quotaType === 'half_day' ? monthsElapsed : 0;
    
    // Check if record exists
    const { data: existing } = await supabase
      .from("employee_leave_balances" as any)
      .select("*")
      .eq("employee_id", employeeId)
      .eq("year", year)
      .maybeSingle();

    if (existing) {
      // Preserve admin-edited allocation values from DB
      const dbFullDay = Number((existing as any).total_allocated);
      const dbHalfDay = Number((existing as any).half_day_allocated ?? 0);
      if (quotaType === 'full_day') {
        const effectiveAlloc = dbFullDay > 0 ? dbFullDay : dynamicFullDay;
        const newUsed = Math.max(0, Number((existing as any).total_used) + usedDelta);
        await supabase
          .from("employee_leave_balances" as any)
          .update({ total_allocated: effectiveAlloc, total_used: newUsed, remaining: effectiveAlloc - newUsed, half_day_allocated: 0 } as any)
          .eq("id", (existing as any).id);
      } else {
        const effectiveAlloc = dbHalfDay > 0 ? dbHalfDay : dynamicHalfDay;
        const newHdUsed = Math.max(0, Number((existing as any).half_day_used ?? 0) + usedDelta);
        await supabase
          .from("employee_leave_balances" as any)
          .update({ half_day_allocated: effectiveAlloc, half_day_used: newHdUsed, half_day_remaining: effectiveAlloc - newHdUsed, total_allocated: 0 } as any)
          .eq("id", (existing as any).id);
      }
    } else {
      const newUsed = Math.max(0, usedDelta);
      if (quotaType === 'full_day') {
        await supabase
          .from("employee_leave_balances" as any)
          .insert({
            employee_id: employeeId, year,
            total_allocated: dynamicFullDay, total_used: newUsed, remaining: dynamicFullDay - newUsed,
            half_day_allocated: 0, half_day_used: 0, half_day_remaining: 0,
          } as any);
      } else {
        await supabase
          .from("employee_leave_balances" as any)
          .insert({
            employee_id: employeeId, year,
            total_allocated: 0, total_used: 0, remaining: 0,
            half_day_allocated: dynamicHalfDay, half_day_used: newUsed, half_day_remaining: dynamicHalfDay - newUsed,
          } as any);
      }
    }
  };

  // Recalculate all balances from approved requests (super admin only)
  const recalcBalancesMutation = useMutation({
    mutationFn: async () => {
      // Fetch all approved leave requests for the selected year
      const yearStart = `${selectedYear}-01-01`;
      const yearEnd = `${selectedYear}-12-31`;
      const { data: approvedLeaves, error } = await supabase
        .from("leave_requests")
        .select("employee_id, total_days")
        .eq("status", "approved")
        .gte("start_date", yearStart)
        .lte("start_date", yearEnd);
      if (error) throw error;

      // Aggregate used days per employee
      const usedMap: Record<string, number> = {};
      (approvedLeaves || []).forEach((req: any) => {
        usedMap[req.employee_id] = (usedMap[req.employee_id] || 0) + Number(req.total_days);
      });

      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const monthsElapsed = selectedYear === currentYear ? currentMonth : 12;

      // For each active employee, upsert the balance record
      for (const emp of employees) {
        const quotaType = (emp as any).leave_quota_type || 'half_day';
        const usedDays = usedMap[emp.id] || 0;
        const dynamicFullDay = quotaType === 'full_day' ? monthsElapsed : 0;
        const dynamicHalfDay = quotaType === 'half_day' ? monthsElapsed : 0;

        const { data: existing } = await supabase
          .from("employee_leave_balances" as any)
          .select("*")
          .eq("employee_id", emp.id)
          .eq("year", selectedYear)
          .maybeSingle();

        const balanceData = quotaType === 'full_day'
          ? { total_allocated: dynamicFullDay, total_used: usedDays, remaining: dynamicFullDay - usedDays, half_day_allocated: 0, half_day_used: 0, half_day_remaining: 0 }
          : { total_allocated: 0, total_used: 0, remaining: 0, half_day_allocated: dynamicHalfDay, half_day_used: usedDays, half_day_remaining: dynamicHalfDay - usedDays };

        if (existing) {
          await supabase
            .from("employee_leave_balances" as any)
            .update(balanceData as any)
            .eq("id", (existing as any).id);
        } else {
          await supabase
            .from("employee_leave_balances" as any)
            .insert({ employee_id: emp.id, year: selectedYear, ...balanceData } as any);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      toast.success("All leave balances recalculated from approved requests!");
    },
    onError: (error: any) => toast.error("Recalculation failed: " + error.message),
  });

  // Update annual quota mutation (super admin only)
  const updateQuotaMutation = useMutation({
    mutationFn: async ({ employeeId, newQuota }: { employeeId: string; newQuota: number }) => {
      const { error: empError } = await supabase
        .from("employees")
        .update({ annual_leaves: newQuota })
        .eq("id", employeeId);
      if (empError) throw empError;

      const { data: existing } = await supabase
        .from("employee_leave_balances" as any)
        .select("*")
        .eq("employee_id", employeeId)
        .eq("year", selectedYear)
        .maybeSingle();

      if (existing) {
        const used = Number((existing as any).total_used);
        await supabase
          .from("employee_leave_balances" as any)
          .update({ total_allocated: newQuota, remaining: newQuota - used } as any)
          .eq("id", (existing as any).id);
      } else {
        await supabase
          .from("employee_leave_balances" as any)
          .insert({ employee_id: employeeId, year: selectedYear, total_allocated: newQuota, total_used: 0, remaining: newQuota } as any);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees-active-leaves"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      toast.success("Leave quota updated!");
      setEditQuotaEmployee(null);
      setEditQuotaValue("");
    },
    onError: (error: any) => toast.error(error.message),
  });

  // Update half-day quota mutation (super admin only)
  const updateHalfDayQuotaMutation = useMutation({
    mutationFn: async ({ employeeId, newQuota }: { employeeId: string; newQuota: number }) => {
      const { error: empError } = await supabase
        .from("employees")
        .update({ half_day_leaves: newQuota } as any)
        .eq("id", employeeId);
      if (empError) throw empError;

      const { data: existing } = await supabase
        .from("employee_leave_balances" as any)
        .select("*")
        .eq("employee_id", employeeId)
        .eq("year", selectedYear)
        .maybeSingle();

      if (existing) {
        const used = Number((existing as any).half_day_used ?? 0);
        await supabase
          .from("employee_leave_balances" as any)
          .update({ half_day_allocated: newQuota, half_day_remaining: newQuota - used } as any)
          .eq("id", (existing as any).id);
      } else {
        const leaveQuota = employees.find(e => e.id === employeeId)?.annual_leaves ?? 18;
        await supabase
          .from("employee_leave_balances" as any)
          .insert({ employee_id: employeeId, year: selectedYear, total_allocated: leaveQuota, total_used: 0, remaining: leaveQuota, half_day_allocated: newQuota, half_day_used: 0, half_day_remaining: newQuota } as any);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees-active-leaves"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      toast.success("Half-day quota updated!");
      setEditHalfDayQuotaEmployee(null);
      setEditHalfDayQuotaValue("");
    },
    onError: (error: any) => toast.error(error.message),
  });

  // Toggle leave quota type mutation (super admin only) — swaps used between buckets
  const toggleQuotaTypeMutation = useMutation({
    mutationFn: async ({ employeeId, newType }: { employeeId: string; newType: string }) => {
      const { error } = await supabase
        .from("employees")
        .update({ leave_quota_type: newType } as any)
        .eq("id", employeeId);
      if (error) throw error;

      // Swap used values between buckets in the balance record
      const { data: existing } = await supabase
        .from("employee_leave_balances" as any)
        .select("*")
        .eq("employee_id", employeeId)
        .eq("year", selectedYear)
        .maybeSingle();

      if (existing) {
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const monthsElapsed = selectedYear === currentYear ? currentMonth : 12;

        if (newType === 'full_day') {
          // Moving from half_day to full_day: transfer half_day_used -> total_used
          const usedFromHd = Number((existing as any).half_day_used ?? 0);
          await supabase
            .from("employee_leave_balances" as any)
            .update({
              total_allocated: monthsElapsed, total_used: usedFromHd, remaining: monthsElapsed - usedFromHd,
              half_day_allocated: 0, half_day_used: 0, half_day_remaining: 0,
            } as any)
            .eq("id", (existing as any).id);
        } else {
          // Moving from full_day to half_day: transfer total_used -> half_day_used
          const usedFromFd = Number((existing as any).total_used ?? 0);
          await supabase
            .from("employee_leave_balances" as any)
            .update({
              half_day_allocated: monthsElapsed, half_day_used: usedFromFd, half_day_remaining: monthsElapsed - usedFromFd,
              total_allocated: 0, total_used: 0, remaining: 0,
            } as any)
            .eq("id", (existing as any).id);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees-active-leaves"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      toast.success("Leave quota type updated!");
    },
    onError: (error: any) => toast.error(error.message),
  });


  const createMutation = useMutation({
    mutationFn: async (data: LeaveFormData) => {
      if (!data.start_date || !data.end_date) throw new Error("Dates required");
      
      let totalDays = differenceInDays(data.end_date, data.start_date) + 1;
      
      // If leave type is Half Day Paid (HDP), each day counts as 0.5
      const selectedLeaveType = leaveTypes.find(t => t.id === data.leave_type_id);
      if (selectedLeaveType?.code === 'HDP') {
        totalDays = totalDays * 0.5;
      }
      
      // Check quota based on employee's quota type
      const balance = balanceMap[data.employee_id];
      const emp = employees.find((e) => e.id === data.employee_id);
      const quotaType = (emp as any)?.leave_quota_type || 'half_day';
      const availableLeaves = quotaType === 'full_day' ? balance?.remaining ?? 0 : balance?.half_day_remaining ?? 0;
      if (balance && totalDays > availableLeaves) {
        throw new Error(`Only ${availableLeaves} leave days remaining. Cannot apply for ${totalDays} days.`);
      }

      const payload = {
        employee_id: data.employee_id,
        leave_type_id: data.leave_type_id,
        start_date: format(data.start_date, "yyyy-MM-dd"),
        end_date: format(data.end_date, "yyyy-MM-dd"),
        total_days: totalDays,
        reason: data.reason || null,
      };

      const { error } = await supabase.from("leave_requests").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      toast.success("Leave request submitted!");
      setShowDialog(false);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  // Update status mutation
  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      // Find request details
      const request = leaveRequests.find((r: any) => r.id === id);
      if (!request) throw new Error("Request not found");

      const payload: any = { status };
      if (status === "approved" || status === "rejected") {
        payload.approved_by = user?.id;
        payload.approved_at = new Date().toISOString();
      }
      
      const { error } = await supabase
        .from("leave_requests")
        .update(payload)
        .eq("id", id);
      if (error) throw error;

      // Update leave balance
      const leaveYear = new Date((request as any).start_date).getFullYear();
      const totalDays = Number((request as any).total_days);

      if (status === "approved") {
        await upsertLeaveBalance((request as any).employee_id, leaveYear, totalDays);
      } else if (status === "rejected" || status === "cancelled") {
        // If previously approved, restore balance
        if ((request as any).status === "approved") {
          await upsertLeaveBalance((request as any).employee_id, leaveYear, -totalDays);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      toast.success("Status updated!");
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      employee_id: "",
      leave_type_id: "",
      start_date: undefined,
      end_date: undefined,
      reason: "",
    });
  };

  const handleAdd = () => {
    resetForm();
    setShowDialog(true);
  };

  const handleView = (request: any) => {
    setSelectedRequest(request);
    setShowViewDialog(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  const selectedEmployeeBalance = formData.employee_id ? balanceMap[formData.employee_id] : null;

  const calculatedDays = formData.start_date && formData.end_date
    ? differenceInDays(formData.end_date, formData.start_date) + 1
    : 0;

  const selectedEmpQuotaType = formData.employee_id ? (employees.find(e => e.id === formData.employee_id) as any)?.leave_quota_type || 'half_day' : 'half_day';
  const availableQuota = selectedEmployeeBalance ? (selectedEmpQuotaType === 'full_day' ? selectedEmployeeBalance.remaining : selectedEmployeeBalance.half_day_remaining) ?? 0 : 0;
  const exceedsQuota = selectedEmployeeBalance && calculatedDays > availableQuota;

  const columns = [
    {
      key: "employees",
      header: "Employee",
      render: (row: any) => (
        <div>
          <div className="font-medium">{row.employees?.full_name}</div>
          <div className="text-xs text-muted-foreground">{row.employees?.employee_code}</div>
        </div>
      ),
    },
    {
      key: "leave_types",
      header: "Leave Type",
      render: (row: any) => (
        <div>
          <div>{row.leave_types?.name || "-"}</div>
          {row.leave_types?.is_paid && <Badge variant="secondary" className="text-xs mt-0.5">Paid</Badge>}
        </div>
      ),
    },
    {
      key: "dates",
      header: "Dates",
      render: (row: any) => (
        <div className="text-sm">
          <div>{format(new Date(row.start_date), "dd MMM yyyy")}</div>
          <div className="text-muted-foreground">to {format(new Date(row.end_date), "dd MMM yyyy")}</div>
        </div>
      ),
    },
    {
      key: "total_days",
      header: "Days",
      render: (row: any) => row.total_days,
    },
    {
      key: "status",
      header: "Status",
      render: (row: any) => <StatusBadge status={row.status} />,
    },
    {
      key: "applied_at",
      header: "Applied",
      render: (row: any) => format(new Date(row.applied_at), "dd MMM yyyy"),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: any) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleView(row)}>
              <Eye className="h-4 w-4 mr-2" />
              View Details
            </DropdownMenuItem>
            {row.status === "pending" && (
              <>
                <DropdownMenuItem onClick={() => statusMutation.mutate({ id: row.id, status: "approved" })}>
                  <Check className="h-4 w-4 mr-2 text-green-500" />
                  Approve
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => statusMutation.mutate({ id: row.id, status: "rejected" })}>
                  <X className="h-4 w-4 mr-2 text-red-500" />
                  Reject
                </DropdownMenuItem>
              </>
            )}
            {row.status === "approved" && (
              <DropdownMenuItem onClick={() => statusMutation.mutate({ id: row.id, status: "cancelled" })}>
                <X className="h-4 w-4 mr-2 text-orange-500" />
                Cancel
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Leave Management"
          description="Manage employee leave applications & annual quota"
        >
          <div className="flex items-center gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleAdd}>
              <Plus className="h-4 w-4 mr-2" />
              New Request
            </Button>
          </div>
        </PageHeader>

        {/* Leave Balance Summary */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <CalendarDays className="h-5 w-5" />
                Leave Balance - {selectedYear}
              </CardTitle>
              <div className="flex items-center gap-2">
                {isSuperAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => recalcBalancesMutation.mutate()}
                    disabled={recalcBalancesMutation.isPending}
                  >
                    <RefreshCw className={cn("h-4 w-4 mr-1", recalcBalancesMutation.isPending && "animate-spin")} />
                    Recalculate
                  </Button>
                )}
                <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                  <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-auto max-h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    {isSuperAdmin && <TableHead className="text-center">Quota Type</TableHead>}
                    <TableHead className="text-center">Leave Quota</TableHead>
                    <TableHead className="text-center">Used</TableHead>
                    <TableHead className="text-center">Remaining</TableHead>
                    <TableHead className="text-center">Half-Day Quota</TableHead>
                    <TableHead className="text-center">HD Used</TableHead>
                    <TableHead className="text-center">HD Remaining</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    {isSuperAdmin && <TableHead className="text-center">Action</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.length === 0 ? (
                    <TableRow><TableCell colSpan={isSuperAdmin ? 12 : 9} className="text-center py-6 text-muted-foreground">No employees</TableCell></TableRow>
                  ) : employees.map((emp) => {
                    const bal = balanceMap[emp.id];
                    const quotaType = (emp as any).leave_quota_type || 'half_day';
                    const allocated = bal?.total_allocated ?? 0;
                    const used = bal?.total_used ?? 0;
                    const remaining = bal?.remaining ?? 0;
                    const hdAllocated = bal?.half_day_allocated ?? 0;
                    const hdUsed = bal?.half_day_used ?? 0;
                    const hdRemaining = bal?.half_day_remaining ?? 0;
                    const activeQuotaRemaining = quotaType === 'full_day' ? remaining : hdRemaining;
                    const isLow = activeQuotaRemaining <= 3 && activeQuotaRemaining > 0;
                    const isZero = activeQuotaRemaining <= 0;
                    return (
                      <TableRow key={emp.id}>
                        <TableCell>
                          <div className="font-medium">{emp.full_name}</div>
                          <div className="text-xs text-muted-foreground">{emp.employee_code}</div>
                        </TableCell>
                        <TableCell className="text-sm">{emp.production_departments?.name || "-"}</TableCell>
                        {isSuperAdmin && (
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-2">
                              <span className={cn("text-xs", quotaType === 'half_day' ? 'font-semibold' : 'text-muted-foreground')}>Half Day</span>
                              <Switch
                                checked={quotaType === 'full_day'}
                                onCheckedChange={(checked) => {
                                  toggleQuotaTypeMutation.mutate({
                                    employeeId: emp.id,
                                    newType: checked ? 'full_day' : 'half_day',
                                  });
                                }}
                                disabled={toggleQuotaTypeMutation.isPending}
                              />
                              <span className={cn("text-xs", quotaType === 'full_day' ? 'font-semibold' : 'text-muted-foreground')}>Full Day</span>
                            </div>
                          </TableCell>
                        )}
                        <TableCell className="text-center font-medium">{allocated}</TableCell>
                        <TableCell className="text-center">{used}</TableCell>
                        <TableCell className="text-center font-semibold">{remaining}</TableCell>
                        <TableCell className="text-center font-medium">{hdAllocated}</TableCell>
                        <TableCell className="text-center">{hdUsed}</TableCell>
                        <TableCell className="text-center font-semibold">{hdRemaining}</TableCell>
                        <TableCell className="text-center">
                          {isZero ? (
                            <Badge variant="destructive" className="text-xs">Exhausted</Badge>
                          ) : isLow ? (
                            <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700">Low</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-green-600">Available</Badge>
                          )}
                        </TableCell>
                        {isSuperAdmin && (
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="Edit Leave Quota"
                                onClick={() => {
                                  setEditQuotaEmployee(emp);
                                  setEditQuotaValue(String(allocated));
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="Edit Half-Day Quota"
                                onClick={() => {
                                  setEditHalfDayQuotaEmployee(emp);
                                  setEditHalfDayQuotaValue(String(hdAllocated));
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5 text-blue-500" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Leave Requests Table */}
        <DataTable
          columns={columns}
          data={leaveRequests}
          emptyMessage="No leave requests found"
        />

        {/* New Leave Request Dialog */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>New Leave Request</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Employee *</Label>
                <Select
                  value={formData.employee_id}
                  onValueChange={(v) => setFormData({ ...formData, employee_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.full_name} ({emp.employee_code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedEmployeeBalance && (
                  <div className="text-xs text-muted-foreground">
                    Leave balance: <span className="font-semibold">{selectedEmployeeBalance.remaining}</span> / {selectedEmployeeBalance.total_allocated} remaining
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Leave Type *</Label>
                <Select
                  value={formData.leave_type_id}
                  onValueChange={(v) => setFormData({ ...formData, leave_type_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select leave type" />
                  </SelectTrigger>
                  <SelectContent>
                    {leaveTypes.map((lt) => (
                      <SelectItem key={lt.id} value={lt.id}>
                        {lt.name} ({lt.code}) {lt.is_paid ? "— Paid" : "— Unpaid"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Date *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !formData.start_date && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.start_date ? format(formData.start_date, "PP") : "Pick date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={formData.start_date}
                        onSelect={(date) => setFormData({ ...formData, start_date: date })}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>End Date *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !formData.end_date && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.end_date ? format(formData.end_date, "PP") : "Pick date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={formData.end_date}
                        onSelect={(date) => setFormData({ ...formData, end_date: date })}
                        initialFocus
                        disabled={(date) => formData.start_date ? date < formData.start_date : false}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {calculatedDays > 0 && (
                <div className={cn(
                  "p-3 rounded-lg text-sm",
                  exceedsQuota ? "bg-destructive/10 border border-destructive/30" : "bg-muted"
                )}>
                  Total: <span className="font-semibold">{calculatedDays} day(s)</span>
                  {exceedsQuota && (
                    <div className="flex items-center gap-1 mt-1 text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span>Exceeds remaining quota ({availableQuota} days left)</span>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label>Reason</Label>
                <Textarea
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  placeholder="Reason for leave..."
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending || !!exceedsQuota}>
                  {createMutation.isPending ? "Submitting..." : "Submit Request"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* View Details Dialog */}
        <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Leave Request Details</DialogTitle>
            </DialogHeader>
            {selectedRequest && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Employee</div>
                    <div className="font-medium">{selectedRequest.employees?.full_name}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Leave Type</div>
                    <div className="font-medium">
                      {selectedRequest.leave_types?.name}
                      {selectedRequest.leave_types?.is_paid && <Badge variant="secondary" className="ml-1 text-xs">Paid</Badge>}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Start Date</div>
                    <div className="font-medium">{format(new Date(selectedRequest.start_date), "PPP")}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">End Date</div>
                    <div className="font-medium">{format(new Date(selectedRequest.end_date), "PPP")}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Total Days</div>
                    <div className="font-medium">{selectedRequest.total_days}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Status</div>
                    <StatusBadge status={selectedRequest.status} />
                  </div>
                </div>
                {selectedRequest.reason && (
                  <div>
                    <div className="text-muted-foreground text-sm">Reason</div>
                    <div className="mt-1 p-2 bg-muted rounded text-sm">{selectedRequest.reason}</div>
                  </div>
                )}
                {selectedRequest.app_users?.full_name && (
                  <div>
                    <div className="text-muted-foreground text-sm">Approved/Rejected By</div>
                    <div className="font-medium">{selectedRequest.app_users.full_name}</div>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Edit Quota Dialog - Super Admin Only */}
        <Dialog open={!!editQuotaEmployee} onOpenChange={(open) => { if (!open) { setEditQuotaEmployee(null); setEditQuotaValue(""); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Edit Leave Quota</DialogTitle>
            </DialogHeader>
            {editQuotaEmployee && (
              <div className="space-y-4">
                <div>
                  <div className="font-medium">{editQuotaEmployee.full_name}</div>
                  <div className="text-sm text-muted-foreground">{editQuotaEmployee.employee_code}</div>
                </div>
                <div className="space-y-2">
                  <Label>Annual Leave Quota</Label>
                  <Input
                    type="number"
                    min={0}
                    value={editQuotaValue}
                    onChange={(e) => setEditQuotaValue(e.target.value)}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => { setEditQuotaEmployee(null); setEditQuotaValue(""); }}>Cancel</Button>
                  <Button
                    onClick={() => {
                      const val = parseInt(editQuotaValue);
                      if (isNaN(val) || val < 0) { toast.error("Enter a valid number"); return; }
                      updateQuotaMutation.mutate({ employeeId: editQuotaEmployee.id, newQuota: val });
                    }}
                    disabled={updateQuotaMutation.isPending}
                  >
                    {updateQuotaMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Edit Half-Day Quota Dialog - Super Admin Only */}
        <Dialog open={!!editHalfDayQuotaEmployee} onOpenChange={(open) => { if (!open) { setEditHalfDayQuotaEmployee(null); setEditHalfDayQuotaValue(""); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Edit Half-Day Quota</DialogTitle>
            </DialogHeader>
            {editHalfDayQuotaEmployee && (
              <div className="space-y-4">
                <div>
                  <div className="font-medium">{editHalfDayQuotaEmployee.full_name}</div>
                  <div className="text-sm text-muted-foreground">{editHalfDayQuotaEmployee.employee_code}</div>
                </div>
                <div className="space-y-2">
                  <Label>Annual Half-Day Quota</Label>
                  <Input
                    type="number"
                    min={0}
                    value={editHalfDayQuotaValue}
                    onChange={(e) => setEditHalfDayQuotaValue(e.target.value)}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => { setEditHalfDayQuotaEmployee(null); setEditHalfDayQuotaValue(""); }}>Cancel</Button>
                  <Button
                    onClick={() => {
                      const val = parseInt(editHalfDayQuotaValue);
                      if (isNaN(val) || val < 0) { toast.error("Enter a valid number"); return; }
                      updateHalfDayQuotaMutation.mutate({ employeeId: editHalfDayQuotaEmployee.id, newQuota: val });
                    }}
                    disabled={updateHalfDayQuotaMutation.isPending}
                  >
                    {updateHalfDayQuotaMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
