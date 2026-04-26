import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  ClipboardCheck, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  TrendingUp,
  AlertCircle,
  CalendarIcon,
  Eye,
  Target,
  Star,
  Settings2
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useNavigate } from "react-router-dom";
import { format, startOfMonth, endOfMonth, startOfDay, endOfDay } from "date-fns";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { cn } from "@/lib/utils";

const COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#3b82f6'];

export default function QADashboard() {
  const navigate = useNavigate();
  const [processViewMode, setProcessViewMode] = useState<"daily" | "monthly">("daily");
  const [processSelectedDate, setProcessSelectedDate] = useState<Date>(new Date());
  const [processTimeFrom, setProcessTimeFrom] = useState<string>("");
  const [processTimeTo, setProcessTimeTo] = useState<string>("");
  const [gradeViewMode, setGradeViewMode] = useState<"daily" | "monthly">("daily");
  const [gradeSelectedDate, setGradeSelectedDate] = useState<Date>(new Date());
  const [gradeTimeFrom, setGradeTimeFrom] = useState<string>("");
  const [gradeTimeTo, setGradeTimeTo] = useState<string>("");
  
  // Total inspections date filter state
  const [totalInspViewMode, setTotalInspViewMode] = useState<"daily" | "monthly">("monthly");
  const [totalInspSelectedDate, setTotalInspSelectedDate] = useState<Date>(new Date());
  
  // Process inspection details dialog state
  const [selectedProcessName, setSelectedProcessName] = useState<string | null>(null);
  const [processDetailsDialogOpen, setProcessDetailsDialogOpen] = useState(false);
  
  // Time vs Inspections chart date filters
  const [qaOfficerChartDate, setQaOfficerChartDate] = useState<Date>(new Date());
  const [qaOfficerChartViewMode, setQaOfficerChartViewMode] = useState<"daily" | "monthly">("daily");
  const [operatorChartDate, setOperatorChartDate] = useState<Date>(new Date());
  const [operatorChartViewMode, setOperatorChartViewMode] = useState<"daily" | "monthly">("daily");
  
  // Key processes state - persist selection in localStorage
  const [keyProcessCodes, setKeyProcessCodes] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("qa-key-process-codes");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return ["016", "017", "065", "059"];
  });
  const [keyProcessSelectorOpen, setKeyProcessSelectorOpen] = useState(false);

  // Persist key process selection to localStorage
  useEffect(() => {
    localStorage.setItem("qa-key-process-codes", JSON.stringify(keyProcessCodes));
  }, [keyProcessCodes]);
  const [keyProcessViewMode, setKeyProcessViewMode] = useState<"daily" | "monthly">("daily");
  const [keyProcessSelectedDate, setKeyProcessSelectedDate] = useState<Date>(new Date());
  
  const today = new Date();
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);

  // Calculate date range for total inspections based on view mode
  const totalInspDateStart = totalInspViewMode === "daily" 
    ? format(startOfDay(totalInspSelectedDate), "yyyy-MM-dd")
    : format(startOfMonth(totalInspSelectedDate), "yyyy-MM-dd");
  const totalInspDateEnd = totalInspViewMode === "daily"
    ? format(endOfDay(totalInspSelectedDate), "yyyy-MM-dd")
    : format(endOfMonth(totalInspSelectedDate), "yyyy-MM-dd");

  // Fetch inspections for total count with date filter
  const { data: inspections = [] } = useQuery({
    queryKey: ["qa-inspections-dashboard", totalInspViewMode, totalInspDateStart, totalInspDateEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_inspections")
        .select("*, qa_processes(name)")
        .gte("inspection_date", totalInspDateStart)
        .lte("inspection_date", totalInspDateEnd);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch grades
  const { data: grades = [] } = useQuery({
    queryKey: ["qa-grades"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grades")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch NCRs for this month
  const { data: ncrs = [] } = useQuery({
    queryKey: ["qa-ncrs-dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_ncr")
        .select("*")
        .gte("ncr_date", format(monthStart, "yyyy-MM-dd"))
        .lte("ncr_date", format(monthEnd, "yyyy-MM-dd"));
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch CAPAs
  const { data: capas = [] } = useQuery({
    queryKey: ["qa-capas-dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_capa")
        .select("*");
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch today's quality plan and items
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const { data: todayPlan } = useQuery({
    queryKey: ["qa-today-plan", todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_daily_plans")
        .select("*")
        .eq("plan_date", todayStr)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: todayPlanItems = [] } = useQuery({
    queryKey: ["qa-today-plan-items", todayPlan?.id],
    queryFn: async () => {
      if (!todayPlan?.id) return [];
      const { data, error } = await supabase
        .from("qa_daily_plan_items")
        .select("*, production_departments(name), qa_processes(name), grades(name), app_users!qa_daily_plan_items_assigned_to_fkey(full_name)")
        .eq("plan_id", todayPlan.id);
      if (error) throw error;
      return data;
    },
    enabled: !!todayPlan?.id,
  });

  // Fetch today's actual inspections for plan progress calculation
  const { data: todayInspections = [] } = useQuery({
    queryKey: ["qa-today-inspections", todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_inspections")
        .select("process_id, grade_id")
        .eq("inspection_date", todayStr);
      if (error) throw error;
      return data;
    },
  });

  // Calculate plan completion
  const planItemsWithProgress = todayPlanItems.map((item: any) => {
    const completed = todayInspections.filter((insp: any) => {
      const processMatch = !item.process_id || insp.process_id === item.process_id;
      const gradeMatch = !item.grade_id || insp.grade_id === item.grade_id;
      return processMatch && gradeMatch;
    }).length;
    return {
      ...item,
      completed,
      progress: item.target_inspections > 0 
        ? Math.min(100, Math.round((completed / item.target_inspections) * 100))
        : 0,
    };
  });

  const totalTargetInspections = planItemsWithProgress.reduce((sum: number, item: any) => sum + item.target_inspections, 0);
  const totalCompletedInspections = planItemsWithProgress.reduce((sum: number, item: any) => sum + Math.min(item.completed, item.target_inspections), 0);
  const overallPlanProgress = totalTargetInspections > 0 
    ? Math.round((totalCompletedInspections / totalTargetInspections) * 100) 
    : 0;

  // Calculate metrics
  const totalInspections = inspections.length;
  const passedInspections = inspections.filter(i => i.result === "pass").length;
  const failedInspections = inspections.filter(i => i.result === "fail").length;
  const holdInspections = inspections.filter(i => i.result === "hold").length;
  const passRate = totalInspections > 0 ? ((passedInspections / totalInspections) * 100).toFixed(1) : "0";

  const openNCRs = ncrs.filter(n => n.status !== "closed").length;
  const pendingCAPAs = capas.filter(c => c.status !== "closed" && c.status !== "approved").length;

  // Pie chart data for inspection results
  const inspectionResultData = [
    { name: "Pass", value: passedInspections },
    { name: "Fail", value: failedInspections },
    { name: "Hold", value: holdInspections },
  ].filter(d => d.value > 0);

  // NCR severity distribution
  const ncrSeverityData = [
    { name: "Low", value: ncrs.filter(n => n.severity === "low").length },
    { name: "Medium", value: ncrs.filter(n => n.severity === "medium").length },
    { name: "High", value: ncrs.filter(n => n.severity === "high").length },
    { name: "Critical", value: ncrs.filter(n => n.severity === "critical").length },
  ].filter(d => d.value > 0);

  // Process-wise inspection results with date filtering
  const processDateStart = processViewMode === "daily" 
    ? format(startOfDay(processSelectedDate), "yyyy-MM-dd")
    : format(startOfMonth(processSelectedDate), "yyyy-MM-dd");
  const processDateEnd = processViewMode === "daily"
    ? format(endOfDay(processSelectedDate), "yyyy-MM-dd")
    : format(endOfMonth(processSelectedDate), "yyyy-MM-dd");

  // Fetch all active processes for sequence ordering
  const { data: allProcesses = [] } = useQuery({
    queryKey: ["qa-processes-for-dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_processes")
        .select("id, code, name, sequence_order")
        .eq("is_active", true)
        .order("sequence_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: processInspections = [] } = useQuery({
    queryKey: ["qa-process-inspections", processViewMode, processDateStart, processDateEnd, processTimeFrom, processTimeTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_inspections")
        .select("*, qa_processes(name, sequence_order), grades(name), created_at")
        .gte("inspection_date", processDateStart)
        .lte("inspection_date", processDateEnd);
      if (error) throw error;
      
      // Filter by time range
      let filtered = data || [];
      if (processTimeFrom || processTimeTo) {
        filtered = filtered.filter((inspection: any) => {
          if (!inspection.created_at) return true;
          const inspTime = new Date(inspection.created_at);
          const inspTimeValue = inspTime.getHours() * 60 + inspTime.getMinutes();
          
          if (processTimeFrom) {
            const [fromH, fromM] = processTimeFrom.split(':').map(Number);
            if (inspTimeValue < fromH * 60 + fromM) return false;
          }
          if (processTimeTo) {
            const [toH, toM] = processTimeTo.split(':').map(Number);
            if (inspTimeValue > toH * 60 + toM) return false;
          }
          return true;
        });
      }
      
      return filtered;
    },
  });

  // Initialize with all processes (including those with no inspections)
  const initialProcessData = allProcesses.reduce((acc, process) => {
    acc[process.name] = { 
      process: process.name, 
      pass: 0, 
      fail: 0, 
      hold: 0, 
      total: 0, 
      sequenceOrder: process.sequence_order ?? 999 
    };
    return acc;
  }, {} as Record<string, { process: string; pass: number; fail: number; hold: number; total: number; sequenceOrder: number }>);

  // Add inspection data to the initialized processes
  const processWiseData = processInspections.reduce((acc, inspection) => {
    const processName = (inspection.qa_processes as any)?.name || "Unknown";
    const sequenceOrder = (inspection.qa_processes as any)?.sequence_order ?? 999;
    if (!acc[processName]) {
      acc[processName] = { process: processName, pass: 0, fail: 0, hold: 0, total: 0, sequenceOrder };
    }
    acc[processName].total += 1;
    if (inspection.result === "pass") acc[processName].pass += 1;
    else if (inspection.result === "fail") acc[processName].fail += 1;
    else if (inspection.result === "hold") acc[processName].hold += 1;
    return acc;
  }, initialProcessData);

  // Sort by sequence_order instead of total count
  const processChartData = Object.values(processWiseData).sort((a, b) => a.sequenceOrder - b.sequenceOrder);

  // Key Process Results - Calculate date range
  const keyProcessDateStart = keyProcessViewMode === "daily" 
    ? format(startOfDay(keyProcessSelectedDate), "yyyy-MM-dd")
    : format(startOfMonth(keyProcessSelectedDate), "yyyy-MM-dd");
  const keyProcessDateEnd = keyProcessViewMode === "daily"
    ? format(endOfDay(keyProcessSelectedDate), "yyyy-MM-dd")
    : format(endOfMonth(keyProcessSelectedDate), "yyyy-MM-dd");

  // Get key process IDs based on selected codes
  const keyProcessIds = allProcesses
    .filter(p => keyProcessCodes.includes(p.code || ''))
    .map(p => p.id);

  // Fetch key process inspections
  const { data: keyProcessInspections = [] } = useQuery({
    queryKey: ["qa-key-process-inspections", keyProcessCodes, keyProcessViewMode, keyProcessDateStart, keyProcessDateEnd],
    queryFn: async () => {
      if (keyProcessIds.length === 0) return [];
      const { data, error } = await supabase
        .from("qa_inspections")
        .select("*, qa_processes(name, code, sequence_order)")
        .in("process_id", keyProcessIds)
        .gte("inspection_date", keyProcessDateStart)
        .lte("inspection_date", keyProcessDateEnd);
      if (error) throw error;
      return data || [];
    },
    enabled: keyProcessIds.length > 0,
  });

  // Build key process chart data
  const keyProcessWiseData = keyProcessCodes.reduce((acc, code) => {
    const process = allProcesses.find(p => p.code === code);
    if (process) {
      acc[process.name] = { 
        process: process.name, 
        pass: 0, 
        fail: 0, 
        hold: 0, 
        total: 0, 
        sequenceOrder: process.sequence_order ?? 999 
      };
    }
    return acc;
  }, {} as Record<string, { process: string; pass: number; fail: number; hold: number; total: number; sequenceOrder: number }>);

  // Add inspection data to key processes
  keyProcessInspections.forEach((inspection) => {
    const processName = (inspection.qa_processes as any)?.name || "Unknown";
    if (keyProcessWiseData[processName]) {
      keyProcessWiseData[processName].total += 1;
      if (inspection.result === "pass") keyProcessWiseData[processName].pass += 1;
      else if (inspection.result === "fail") keyProcessWiseData[processName].fail += 1;
      else if (inspection.result === "hold") keyProcessWiseData[processName].hold += 1;
    }
  });

  // Sort key processes by sequence_order
  const keyProcessChartData = Object.values(keyProcessWiseData).sort((a, b) => a.sequenceOrder - b.sequenceOrder);

  // Get inspections for selected process for the dialog
  const selectedProcessInspections = selectedProcessName 
    ? processInspections.filter(i => (i.qa_processes as any)?.name === selectedProcessName)
    : [];

  // Get inspection IDs for fetching readings
  const selectedInspectionIds = selectedProcessInspections.map(i => i.id);

  // Fetch inspection readings for selected inspections
  const { data: inspectionReadings = [] } = useQuery({
    queryKey: ["qa-inspection-readings", selectedInspectionIds],
    queryFn: async () => {
      if (selectedInspectionIds.length === 0) return [];
      const { data, error } = await supabase
        .from("qa_inspection_readings")
        .select("*, qa_process_parameters(parameter_name, parameter_type, unit, min_value, max_value)")
        .in("inspection_id", selectedInspectionIds);
      if (error) throw error;
      return data || [];
    },
    enabled: selectedInspectionIds.length > 0 && processDetailsDialogOpen,
  });

  // Group readings by inspection_id
  const readingsByInspection = inspectionReadings.reduce((acc, reading) => {
    if (!acc[reading.inspection_id]) {
      acc[reading.inspection_id] = [];
    }
    acc[reading.inspection_id].push(reading);
    return acc;
  }, {} as Record<string, typeof inspectionReadings>);

  const handleViewProcessDetails = (processName: string) => {
    setSelectedProcessName(processName);
    setProcessDetailsDialogOpen(true);
  };

  // Helper function to format reading value
  const formatReadingValue = (reading: any) => {
    const param = reading.qa_process_parameters;
    if (!param) return "-";
    
    if (param.parameter_type === "boolean") {
      return reading.value_boolean ? "Yes" : "No";
    } else if (param.parameter_type === "number") {
      const value = reading.value_number;
      const unit = param.unit || "";
      return value !== null ? `${value}${unit ? ` ${unit}` : ""}` : "-";
    } else {
      return reading.value_text || "-";
    }
  };

  // Grade-wise inspection results with date filtering
  const gradeDateStart = gradeViewMode === "daily" 
    ? format(startOfDay(gradeSelectedDate), "yyyy-MM-dd")
    : format(startOfMonth(gradeSelectedDate), "yyyy-MM-dd");
  const gradeDateEnd = gradeViewMode === "daily"
    ? format(endOfDay(gradeSelectedDate), "yyyy-MM-dd")
    : format(endOfMonth(gradeSelectedDate), "yyyy-MM-dd");

  const { data: gradeInspections = [] } = useQuery({
    queryKey: ["qa-grade-inspections", gradeViewMode, gradeDateStart, gradeDateEnd, gradeTimeFrom, gradeTimeTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_inspections")
        .select("*, qa_processes(name), grades(name), created_at")
        .gte("inspection_date", gradeDateStart)
        .lte("inspection_date", gradeDateEnd);
      if (error) throw error;
      
      // Filter by time range
      let filtered = data || [];
      if (gradeTimeFrom || gradeTimeTo) {
        filtered = filtered.filter((inspection: any) => {
          if (!inspection.created_at) return true;
          const inspTime = new Date(inspection.created_at);
          const inspTimeValue = inspTime.getHours() * 60 + inspTime.getMinutes();
          
          if (gradeTimeFrom) {
            const [fromH, fromM] = gradeTimeFrom.split(':').map(Number);
            if (inspTimeValue < fromH * 60 + fromM) return false;
          }
          if (gradeTimeTo) {
            const [toH, toM] = gradeTimeTo.split(':').map(Number);
            if (inspTimeValue > toH * 60 + toM) return false;
          }
          return true;
        });
      }
      
      return filtered;
    },
  });

  // Group inspections by grade, then by process within each grade
  const gradeWiseData = gradeInspections.reduce((acc, inspection) => {
    const gradeName = (inspection.grades as any)?.name || "Unknown";
    const processName = (inspection.qa_processes as any)?.name || "Unknown";
    
    if (!acc[gradeName]) {
      acc[gradeName] = { grade: gradeName, processes: {}, total: 0, pass: 0, fail: 0, hold: 0 };
    }
    
    if (!acc[gradeName].processes[processName]) {
      acc[gradeName].processes[processName] = { process: processName, pass: 0, fail: 0, hold: 0, total: 0 };
    }
    
    acc[gradeName].total += 1;
    acc[gradeName].processes[processName].total += 1;
    
    if (inspection.result === "pass") {
      acc[gradeName].pass += 1;
      acc[gradeName].processes[processName].pass += 1;
    } else if (inspection.result === "fail") {
      acc[gradeName].fail += 1;
      acc[gradeName].processes[processName].fail += 1;
    } else if (inspection.result === "hold") {
      acc[gradeName].hold += 1;
      acc[gradeName].processes[processName].hold += 1;
    }
    
    return acc;
  }, {} as Record<string, { 
    grade: string; 
    processes: Record<string, { process: string; pass: number; fail: number; hold: number; total: number }>;
    total: number; 
    pass: number; 
    fail: number; 
    hold: number; 
  }>);

  const gradeChartData = Object.values(gradeWiseData).sort((a, b) => b.total - a.total);

  // User-wise (Operators & QA Officers) process inspections
  const { data: userProcessInspections } = useQuery({
    queryKey: ['user-process-inspections', totalInspDateStart, totalInspDateEnd],
    queryFn: async () => {
      // Fetch inspections with user and process info
      const { data: userInspections, error } = await supabase
        .from('qa_inspections')
        .select(`
          id,
          process_id,
          created_by,
          qa_processes(id, name),
          app_users!qa_inspections_created_by_fkey(id, full_name)
        `)
        .gte('inspection_date', totalInspDateStart)
        .lte('inspection_date', totalInspDateEnd);
      
      if (error) throw error;

      // Fetch user roles to identify operators vs QA officers
      const userIds = [...new Set(userInspections?.map(i => i.created_by).filter(Boolean))] as string[];
      
      if (userIds.length === 0) return { operators: [], qaOfficers: [] };

      const { data: userRoles } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('user_id', userIds);

      const roleMap: Record<string, string> = {};
      userRoles?.forEach(ur => {
        roleMap[ur.user_id] = ur.role;
      });

      // Group by user, then by process
      const byUser: Record<string, {
        userName: string;
        role: string;
        processes: Record<string, number>;
      }> = {};

      userInspections?.forEach(insp => {
        const user = insp.app_users as any;
        const process = insp.qa_processes as any;
        if (!user || !process) return;

        const userId = user.id;
        if (!byUser[userId]) {
          byUser[userId] = {
            userName: user.full_name,
            role: roleMap[userId] || 'user',
            processes: {},
          };
        }

        const processName = process.name;
        byUser[userId].processes[processName] = (byUser[userId].processes[processName] || 0) + 1;
      });

      // Separate operators and QA officers
      const operators: Array<{ userId: string; userName: string; processData: Array<{ name: string; value: number }> }> = [];
      const qaOfficers: Array<{ userId: string; userName: string; processData: Array<{ name: string; value: number }> }> = [];

      Object.entries(byUser).forEach(([userId, data]) => {
        const userData = {
          userId,
          userName: data.userName,
          processData: Object.entries(data.processes).map(([name, value]) => ({ name, value })),
        };

        if (data.role === 'operator') {
          operators.push(userData);
        } else {
          qaOfficers.push(userData);
        }
      });

      return { operators, qaOfficers };
    },
  });

  // QA Officers Time vs Inspections Data
  const qaOfficerDateStart = qaOfficerChartViewMode === "daily" 
    ? format(startOfDay(qaOfficerChartDate), "yyyy-MM-dd")
    : format(startOfMonth(qaOfficerChartDate), "yyyy-MM-dd");
  const qaOfficerDateEnd = qaOfficerChartViewMode === "daily"
    ? format(endOfDay(qaOfficerChartDate), "yyyy-MM-dd")
    : format(endOfMonth(qaOfficerChartDate), "yyyy-MM-dd");

  const { data: qaOfficerTimeData = [] } = useQuery({
    queryKey: ['qa-officer-time-inspections', qaOfficerDateStart, qaOfficerDateEnd],
    queryFn: async () => {
      // Fetch inspections with user and timestamp info
      const { data: timeInspections, error } = await supabase
        .from('qa_inspections')
        .select(`
          id,
          created_at,
          inspection_date,
          created_by,
          app_users!qa_inspections_created_by_fkey(id, full_name)
        `)
        .gte('inspection_date', qaOfficerDateStart)
        .lte('inspection_date', qaOfficerDateEnd);
      
      if (error) throw error;

      // Fetch user roles to identify QA officers
      const userIds = [...new Set(timeInspections?.map(i => i.created_by).filter(Boolean))] as string[];
      
      if (userIds.length === 0) return [];

      const { data: userRoles } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('user_id', userIds);

      const roleMap: Record<string, string> = {};
      userRoles?.forEach(ur => {
        roleMap[ur.user_id] = ur.role;
      });

      // Filter only QA officers (non-operators)
      const qaInspections = timeInspections?.filter(insp => {
        const userId = insp.created_by;
        return userId && roleMap[userId] !== 'operator';
      }) || [];

      // Group by hour of day
      const hourlyData: Record<string, Record<string, number>> = {};
      
      qaInspections.forEach(insp => {
        const user = insp.app_users as any;
        if (!user || !insp.created_at) return;
        
        const hour = new Date(insp.created_at).getHours();
        const hourLabel = `${hour.toString().padStart(2, '0')}:00`;
        
        if (!hourlyData[hourLabel]) {
          hourlyData[hourLabel] = {};
        }
        
        const userName = user.full_name;
        hourlyData[hourLabel][userName] = (hourlyData[hourLabel][userName] || 0) + 1;
      });

      // Get all unique QA officer names
      const allOfficers = [...new Set(qaInspections.map(i => (i.app_users as any)?.full_name).filter(Boolean))];

      // Convert to chart data format
      const chartData = Object.entries(hourlyData)
        .map(([hour, officers]) => {
          const entry: Record<string, any> = { hour };
          allOfficers.forEach(officer => {
            entry[officer] = officers[officer] || 0;
          });
          return entry;
        })
        .sort((a, b) => a.hour.localeCompare(b.hour));

      return { chartData, officers: allOfficers };
    },
  });

  // Machine Operators Time vs Inspections Data
  const operatorDateStart = operatorChartViewMode === "daily" 
    ? format(startOfDay(operatorChartDate), "yyyy-MM-dd")
    : format(startOfMonth(operatorChartDate), "yyyy-MM-dd");
  const operatorDateEnd = operatorChartViewMode === "daily"
    ? format(endOfDay(operatorChartDate), "yyyy-MM-dd")
    : format(endOfMonth(operatorChartDate), "yyyy-MM-dd");

  const { data: operatorTimeData = [] } = useQuery({
    queryKey: ['operator-time-inspections', operatorDateStart, operatorDateEnd],
    queryFn: async () => {
      // Fetch inspections with user and timestamp info
      const { data: timeInspections, error } = await supabase
        .from('qa_inspections')
        .select(`
          id,
          created_at,
          inspection_date,
          created_by,
          app_users!qa_inspections_created_by_fkey(id, full_name)
        `)
        .gte('inspection_date', operatorDateStart)
        .lte('inspection_date', operatorDateEnd);
      
      if (error) throw error;

      // Fetch user roles to identify operators
      const userIds = [...new Set(timeInspections?.map(i => i.created_by).filter(Boolean))] as string[];
      
      if (userIds.length === 0) return [];

      const { data: userRoles } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('user_id', userIds);

      const roleMap: Record<string, string> = {};
      userRoles?.forEach(ur => {
        roleMap[ur.user_id] = ur.role;
      });

      // Filter only operators
      const operatorInspections = timeInspections?.filter(insp => {
        const userId = insp.created_by;
        return userId && roleMap[userId] === 'operator';
      }) || [];

      // Group by hour of day
      const hourlyData: Record<string, Record<string, number>> = {};
      
      operatorInspections.forEach(insp => {
        const user = insp.app_users as any;
        if (!user || !insp.created_at) return;
        
        const hour = new Date(insp.created_at).getHours();
        const hourLabel = `${hour.toString().padStart(2, '0')}:00`;
        
        if (!hourlyData[hourLabel]) {
          hourlyData[hourLabel] = {};
        }
        
        const userName = user.full_name;
        hourlyData[hourLabel][userName] = (hourlyData[hourLabel][userName] || 0) + 1;
      });

      // Get all unique operator names
      const allOperators = [...new Set(operatorInspections.map(i => (i.app_users as any)?.full_name).filter(Boolean))];

      // Convert to chart data format
      const chartData = Object.entries(hourlyData)
        .map(([hour, operators]) => {
          const entry: Record<string, any> = { hour };
          allOperators.forEach(operator => {
            entry[operator] = operators[operator] || 0;
          });
          return entry;
        })
        .sort((a, b) => a.hour.localeCompare(b.hour));

      return { chartData, operators: allOperators };
    },
  });

  // Colors for charts
  const CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

  // Colors for QA officers in chart
  const QA_OFFICER_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader 
          title="QA Dashboard" 
          description="Quality Assurance overview and metrics"
        />

        {/* Total Inspections Card with Date Filter */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5" />
                Total Inspections
              </CardTitle>
              <div className="flex items-center gap-2">
                {/* View Mode Toggle */}
                <div className="flex items-center border rounded-lg overflow-hidden">
                  <Button
                    variant={totalInspViewMode === "daily" ? "default" : "ghost"}
                    size="sm"
                    className="rounded-none h-8 text-xs"
                    onClick={() => setTotalInspViewMode("daily")}
                  >
                    Daily
                  </Button>
                  <Button
                    variant={totalInspViewMode === "monthly" ? "default" : "ghost"}
                    size="sm"
                    className="rounded-none h-8 text-xs"
                    onClick={() => setTotalInspViewMode("monthly")}
                  >
                    Monthly
                  </Button>
                </div>
                
                {/* Date Picker */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-2">
                      <CalendarIcon className="h-4 w-4" />
                      {totalInspViewMode === "daily" 
                        ? format(totalInspSelectedDate, "dd MMM yyyy")
                        : format(totalInspSelectedDate, "MMM yyyy")
                      }
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="single"
                      selected={totalInspSelectedDate}
                      onSelect={(date) => date && setTotalInspSelectedDate(date)}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <div className="text-3xl font-bold">{totalInspections}</div>
                <div className="text-sm text-muted-foreground">Total</div>
              </div>
              <div className="text-center p-4 rounded-lg bg-green-500/10">
                <div className="text-3xl font-bold text-green-600">{passedInspections}</div>
                <div className="text-sm text-muted-foreground">Passed</div>
              </div>
              <div className="text-center p-4 rounded-lg bg-red-500/10">
                <div className="text-3xl font-bold text-red-600">{failedInspections}</div>
                <div className="text-sm text-muted-foreground">Failed</div>
              </div>
              <div className="text-center p-4 rounded-lg bg-amber-500/10">
                <div className="text-3xl font-bold text-amber-600">{holdInspections}</div>
                <div className="text-sm text-muted-foreground">Hold</div>
              </div>
            </div>
            <div className="mt-4 text-center">
              <span className="text-lg font-semibold">Pass Rate: </span>
              <span className={cn(
                "text-lg font-bold",
                Number(passRate) >= 90 ? "text-green-600" : Number(passRate) >= 70 ? "text-amber-600" : "text-red-600"
              )}>
                {passRate}%
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Other Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard
            title="Pass Rate"
            value={`${passRate}%`}
            icon={CheckCircle2}
            description={`${passedInspections} passed`}
          />
          <MetricCard
            title="Open NCRs"
            value={openNCRs}
            icon={AlertTriangle}
            description="Pending resolution"
          />
          <MetricCard
            title="Pending CAPAs"
            value={pendingCAPAs}
            icon={Clock}
            description="Awaiting completion"
          />
        </div>

        {/* Today's Quality Plan Progress */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-5 w-5" />
                Today's Quality Plan
              </CardTitle>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => navigate("/qa/daily-plan")}
              >
                View Full Plan
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {todayPlan ? (
              <div className="space-y-4">
                {/* Overall Progress */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Overall Progress</span>
                  <span className={cn(
                    "text-sm font-bold",
                    overallPlanProgress >= 100 ? "text-green-600" : 
                    overallPlanProgress >= 50 ? "text-amber-600" : "text-muted-foreground"
                  )}>
                    {overallPlanProgress}%
                  </span>
                </div>
                <Progress value={overallPlanProgress} className="h-3" />
                
                <div className="grid grid-cols-3 gap-4 mt-4 text-center">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <div className="text-2xl font-bold">{planItemsWithProgress.length}</div>
                    <div className="text-xs text-muted-foreground">Plan Items</div>
                  </div>
                  <div className="p-3 rounded-lg bg-blue-500/10">
                    <div className="text-2xl font-bold text-blue-600">{totalTargetInspections}</div>
                    <div className="text-xs text-muted-foreground">Target</div>
                  </div>
                  <div className="p-3 rounded-lg bg-green-500/10">
                    <div className="text-2xl font-bold text-green-600">{totalCompletedInspections}</div>
                    <div className="text-xs text-muted-foreground">Completed</div>
                  </div>
                </div>

                {/* Plan Items Progress */}
                {planItemsWithProgress.length > 0 && (
                  <div className="mt-4 space-y-3 max-h-[200px] overflow-y-auto">
                    {planItemsWithProgress.map((item: any, index: number) => (
                      <div key={item.id || index} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1 gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm font-medium truncate">
                                {item.qa_processes?.name || "All Processes"}
                                {item.grades?.name && ` - ${item.grades.name}`}
                              </span>
                              {item.app_users?.full_name && (
                                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded truncate">
                                  {item.app_users.full_name}
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {item.completed}/{item.target_inspections}
                            </span>
                          </div>
                          <Progress 
                            value={item.progress} 
                            className={cn(
                              "h-2",
                              item.progress >= 100 ? "[&>div]:bg-green-500" : ""
                            )} 
                          />
                        </div>
                        {item.progress >= 100 && (
                          <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Target className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No quality plan for today</p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-3"
                  onClick={() => navigate("/qa/daily-plan")}
                >
                  Create Plan
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Inspection Results Pie Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Inspection Results
              </CardTitle>
            </CardHeader>
            <CardContent>
              {inspectionResultData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={inspectionResultData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {inspectionResultData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                  No inspection data available
                </div>
              )}
            </CardContent>
          </Card>

          {/* NCR Severity Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                NCR Severity Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ncrSeverityData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={ncrSeverityData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                  No NCR data available
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Key Process Results */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Star className="h-5 w-5 text-amber-500" />
              Key Process Results
            </CardTitle>
            <div className="flex items-center gap-3">
              {/* View Mode Toggle */}
              <div className="flex items-center border rounded-lg overflow-hidden">
                <Button
                  variant={keyProcessViewMode === "daily" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-none h-8"
                  onClick={() => setKeyProcessViewMode("daily")}
                >
                  Daily
                </Button>
                <Button
                  variant={keyProcessViewMode === "monthly" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-none h-8"
                  onClick={() => setKeyProcessViewMode("monthly")}
                >
                  Monthly
                </Button>
              </div>
              
              {/* Date Picker */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    {keyProcessViewMode === "daily" 
                      ? format(keyProcessSelectedDate, "dd MMM yyyy")
                      : format(keyProcessSelectedDate, "MMM yyyy")
                    }
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={keyProcessSelectedDate}
                    onSelect={(date) => date && setKeyProcessSelectedDate(date)}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>

              {/* Key Process Selector */}
              <Popover open={keyProcessSelectorOpen} onOpenChange={setKeyProcessSelectorOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-2">
                    <Settings2 className="h-4 w-4" />
                    Select Processes
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="end">
                  <div className="p-3 border-b">
                    <h4 className="font-medium text-sm">Select Key Processes</h4>
                    <p className="text-xs text-muted-foreground">Choose processes to highlight</p>
                  </div>
                  <ScrollArea className="h-[300px]">
                    <div className="p-2 space-y-1">
                      {allProcesses.map((process) => (
                        <div
                          key={process.id}
                          className="flex items-center gap-2 p-2 rounded-md hover:bg-muted cursor-pointer"
                          onClick={() => {
                            setKeyProcessCodes(prev => 
                              prev.includes(process.code || '')
                                ? prev.filter(c => c !== process.code)
                                : [...prev, process.code || '']
                            );
                          }}
                        >
                          <Checkbox 
                            checked={keyProcessCodes.includes(process.code || '')}
                            onCheckedChange={(checked) => {
                              setKeyProcessCodes(prev => 
                                checked
                                  ? [...prev, process.code || '']
                                  : prev.filter(c => c !== process.code)
                              );
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{process.name}</p>
                            <p className="text-xs text-muted-foreground">Code: {process.code}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            </div>
          </CardHeader>
          <CardContent>
            {keyProcessChartData.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {keyProcessChartData.map((processData) => {
                  const pieData = [
                    { name: "Pass", value: processData.pass },
                    { name: "Fail", value: processData.fail },
                    { name: "Hold", value: processData.hold },
                  ].filter(d => d.value > 0);
                  
                  const passRate = processData.total > 0 
                    ? ((processData.pass / processData.total) * 100).toFixed(0) 
                    : "0";

                  return (
                    <div key={processData.process} className="border rounded-lg p-4 bg-amber-50/30 dark:bg-amber-950/10">
                      <h4 className="font-medium text-sm text-center mb-2 truncate" title={processData.process}>
                        {processData.process}
                      </h4>
                      <p className="text-xs text-muted-foreground text-center mb-2">
                        {processData.total} inspections • {passRate}% pass
                      </p>
                      {processData.total === 0 ? (
                        <ResponsiveContainer width="100%" height={150}>
                          <PieChart>
                            <Pie
                              data={[{ name: "No Data", value: 1 }]}
                              cx="50%"
                              cy="50%"
                              innerRadius={30}
                              outerRadius={55}
                              paddingAngle={0}
                              dataKey="value"
                            >
                              <Cell fill="#3b82f6" />
                            </Pie>
                            <Tooltip formatter={() => ["No inspections", "Status"]} />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : pieData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={150}>
                          <PieChart>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={30}
                              outerRadius={55}
                              paddingAngle={3}
                              dataKey="value"
                            >
                              {pieData.map((entry, index) => (
                                <Cell 
                                  key={`cell-${index}`} 
                                  fill={
                                    entry.name === "Pass" ? "#22c55e" :
                                    entry.name === "Fail" ? "#ef4444" : "#f59e0b"
                                  } 
                                />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value: number, name: string) => [value, name]} />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-[150px] flex items-center justify-center text-muted-foreground text-xs">
                          No data
                        </div>
                      )}
                      <div className="flex justify-center gap-3 mt-2 text-xs">
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-green-500"></span>
                          {processData.pass}
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-red-500"></span>
                          {processData.fail}
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                          {processData.hold}
                        </span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-3"
                        onClick={() => handleViewProcessDetails(processData.process)}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        View Details
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                No key processes selected
              </div>
            )}
          </CardContent>
        </Card>

        {/* Process-wise Inspection Results - Pie Charts */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              Process-wise Inspection Results
            </CardTitle>
            <div className="flex items-center gap-3">
              {/* View Mode Toggle */}
              <div className="flex items-center border rounded-lg overflow-hidden">
                <Button
                  variant={processViewMode === "daily" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-none h-8"
                  onClick={() => setProcessViewMode("daily")}
                >
                  Daily
                </Button>
                <Button
                  variant={processViewMode === "monthly" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-none h-8"
                  onClick={() => setProcessViewMode("monthly")}
                >
                  Monthly
                </Button>
              </div>
              
              {/* Date Picker */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    {processViewMode === "daily" 
                      ? format(processSelectedDate, "dd MMM yyyy")
                      : format(processSelectedDate, "MMM yyyy")
                    }
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={processSelectedDate}
                    onSelect={(date) => date && setProcessSelectedDate(date)}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>

              {/* Time Filter */}
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <input
                  type="time"
                  value={processTimeFrom}
                  onChange={(e) => setProcessTimeFrom(e.target.value)}
                  className="h-8 px-2 rounded-md border border-input bg-background text-sm w-[90px]"
                />
                <span className="text-muted-foreground text-xs">to</span>
                <input
                  type="time"
                  value={processTimeTo}
                  onChange={(e) => setProcessTimeTo(e.target.value)}
                  className="h-8 px-2 rounded-md border border-input bg-background text-sm w-[90px]"
                />
                {(processTimeFrom || processTimeTo) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setProcessTimeFrom(""); setProcessTimeTo(""); }}
                    className="h-8 px-2 text-xs"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {processChartData.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {processChartData.map((processData) => {
                  const pieData = [
                    { name: "Pass", value: processData.pass },
                    { name: "Fail", value: processData.fail },
                    { name: "Hold", value: processData.hold },
                  ].filter(d => d.value > 0);
                  
                  const passRate = processData.total > 0 
                    ? ((processData.pass / processData.total) * 100).toFixed(0) 
                    : "0";

                  return (
                    <div key={processData.process} className="border rounded-lg p-4">
                      <h4 className="font-medium text-sm text-center mb-2 truncate" title={processData.process}>
                        {processData.process}
                      </h4>
                      <p className="text-xs text-muted-foreground text-center mb-2">
                        {processData.total} inspections • {passRate}% pass
                      </p>
                      {processData.total === 0 ? (
                        // Show blue chart for processes with no inspections
                        <ResponsiveContainer width="100%" height={150}>
                          <PieChart>
                            <Pie
                              data={[{ name: "No Data", value: 1 }]}
                              cx="50%"
                              cy="50%"
                              innerRadius={30}
                              outerRadius={55}
                              paddingAngle={0}
                              dataKey="value"
                            >
                              <Cell fill="#3b82f6" />
                            </Pie>
                            <Tooltip formatter={() => ["No inspections", "Status"]} />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : pieData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={150}>
                          <PieChart>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={30}
                              outerRadius={55}
                              paddingAngle={3}
                              dataKey="value"
                            >
                              {pieData.map((entry, index) => (
                                <Cell 
                                  key={`cell-${index}`} 
                                  fill={
                                    entry.name === "Pass" ? "#22c55e" :
                                    entry.name === "Fail" ? "#ef4444" : "#f59e0b"
                                  } 
                                />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value: number, name: string) => [value, name]} />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-[150px] flex items-center justify-center text-muted-foreground text-xs">
                          No data
                        </div>
                      )}
                      <div className="flex justify-center gap-3 mt-2 text-xs">
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-green-500"></span>
                          {processData.pass}
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-red-500"></span>
                          {processData.fail}
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                          {processData.hold}
                        </span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-3"
                        onClick={() => handleViewProcessDetails(processData.process)}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        View Details
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                No process inspection data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Grade-wise Inspection Results */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Grade-wise Inspection Results
            </CardTitle>
            <div className="flex items-center gap-3">
              {/* View Mode Toggle */}
              <div className="flex items-center border rounded-lg overflow-hidden">
                <Button
                  variant={gradeViewMode === "daily" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-none h-8"
                  onClick={() => setGradeViewMode("daily")}
                >
                  Daily
                </Button>
                <Button
                  variant={gradeViewMode === "monthly" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-none h-8"
                  onClick={() => setGradeViewMode("monthly")}
                >
                  Monthly
                </Button>
              </div>
              
              {/* Date Picker */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    {gradeViewMode === "daily" 
                      ? format(gradeSelectedDate, "dd MMM yyyy")
                      : format(gradeSelectedDate, "MMM yyyy")
                    }
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={gradeSelectedDate}
                    onSelect={(date) => date && setGradeSelectedDate(date)}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>

              {/* Time Filter */}
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <input
                  type="time"
                  value={gradeTimeFrom}
                  onChange={(e) => setGradeTimeFrom(e.target.value)}
                  className="h-8 px-2 rounded-md border border-input bg-background text-sm w-[90px]"
                />
                <span className="text-muted-foreground text-xs">to</span>
                <input
                  type="time"
                  value={gradeTimeTo}
                  onChange={(e) => setGradeTimeTo(e.target.value)}
                  className="h-8 px-2 rounded-md border border-input bg-background text-sm w-[90px]"
                />
                {(gradeTimeFrom || gradeTimeTo) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setGradeTimeFrom(""); setGradeTimeTo(""); }}
                    className="h-8 px-2 text-xs"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {gradeChartData.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {gradeChartData.map((gradeData) => {
                  const processResults = Object.values(gradeData.processes);
                  const passRate = gradeData.total > 0 
                    ? ((gradeData.pass / gradeData.total) * 100).toFixed(0) 
                    : "0";

                  // Create pie data for process results within this grade
                  const pieData = processResults.map(proc => ({
                    name: proc.process,
                    value: proc.total,
                    pass: proc.pass,
                    fail: proc.fail,
                    hold: proc.hold
                  })).filter(d => d.value > 0);

                  const PROCESS_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#6366f1', '#14b8a6'];

                  return (
                    <div key={gradeData.grade} className="border rounded-lg p-4">
                      <h4 className="font-medium text-center mb-1">
                        Grade: {gradeData.grade}
                      </h4>
                      <p className="text-xs text-muted-foreground text-center mb-3">
                        {gradeData.total} inspections • {passRate}% pass rate
                      </p>
                      
                      {pieData.length > 0 ? (
                        <>
                          <ResponsiveContainer width="100%" height={180}>
                            <PieChart>
                              <Pie
                                data={pieData}
                                cx="50%"
                                cy="50%"
                                innerRadius={35}
                                outerRadius={70}
                                paddingAngle={2}
                                dataKey="value"
                              >
                                {pieData.map((_, index) => (
                                  <Cell 
                                    key={`cell-${index}`} 
                                    fill={PROCESS_COLORS[index % PROCESS_COLORS.length]} 
                                  />
                                ))}
                              </Pie>
                              <Tooltip 
                                formatter={(value: number, name: string, props: any) => [
                                  `${value} (P:${props.payload.pass} F:${props.payload.fail} H:${props.payload.hold})`,
                                  name
                                ]} 
                              />
                            </PieChart>
                          </ResponsiveContainer>
                          
                          {/* Process Legend */}
                          <div className="mt-3 space-y-1.5">
                            {pieData.map((proc, index) => (
                              <div key={proc.name} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                  <span 
                                    className="w-2.5 h-2.5 rounded-full" 
                                    style={{ backgroundColor: PROCESS_COLORS[index % PROCESS_COLORS.length] }}
                                  />
                                  <span className="truncate max-w-[100px]" title={proc.name}>{proc.name}</span>
                                </div>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                  <span className="text-green-600">{proc.pass}P</span>
                                  <span className="text-red-600">{proc.fail}F</span>
                                  <span className="text-amber-600">{proc.hold}H</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="h-[180px] flex items-center justify-center text-muted-foreground text-xs">
                          No data
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                No grade inspection data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Inspections */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Inspections</CardTitle>
            </CardHeader>
            <CardContent>
              {inspections.length > 0 ? (
                <div className="space-y-3">
                  {inspections.slice(0, 5).map((inspection) => (
                    <div key={inspection.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium text-sm">{inspection.inspection_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {(inspection.qa_processes as any)?.name || "Unknown Process"}
                        </p>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        inspection.result === "pass" ? "bg-green-100 text-green-700" :
                        inspection.result === "fail" ? "bg-red-100 text-red-700" :
                        "bg-yellow-100 text-yellow-700"
                      }`}>
                        {inspection.result?.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">No recent inspections</p>
              )}
            </CardContent>
          </Card>

          {/* Open NCRs */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Open NCRs</CardTitle>
            </CardHeader>
            <CardContent>
              {ncrs.filter(n => n.status !== "closed").length > 0 ? (
                <div className="space-y-3">
                  {ncrs.filter(n => n.status !== "closed").slice(0, 5).map((ncr) => (
                    <div key={ncr.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium text-sm">{ncr.ncr_number}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {ncr.description}
                        </p>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        ncr.severity === "critical" ? "bg-red-100 text-red-700" :
                        ncr.severity === "high" ? "bg-orange-100 text-orange-700" :
                        ncr.severity === "medium" ? "bg-yellow-100 text-yellow-700" :
                        "bg-blue-100 text-blue-700"
                      }`}>
                        {ncr.severity?.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">No open NCRs</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Machine Operators - Process-wise Inspections */}
        {userProcessInspections?.operators && userProcessInspections.operators.length > 0 && (
          <>
            <h3 className="text-lg font-semibold mb-4">Machine Operators - Process-wise Inspections</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-6">
              {userProcessInspections.operators.map((operator) => (
                <Card key={operator.userId}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">{operator.userName}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Total: {operator.processData.reduce((sum, p) => sum + p.value, 0)} inspections
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[200px]">
                      {operator.processData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={operator.processData}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              label={({ name, value }) => `${name}: ${value}`}
                              outerRadius={60}
                              fill="#8884d8"
                              dataKey="value"
                            >
                              {operator.processData.map((_, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: 'hsl(var(--card))', 
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px'
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                          No inspections
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}

        {/* QA Officers - Process-wise Inspections */}
        {userProcessInspections?.qaOfficers && userProcessInspections.qaOfficers.length > 0 && (
          <>
            <h3 className="text-lg font-semibold mb-4">QA Officers - Process-wise Inspections</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-6">
              {userProcessInspections.qaOfficers.map((officer) => (
                <Card key={officer.userId}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">{officer.userName}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Total: {officer.processData.reduce((sum, p) => sum + p.value, 0)} inspections
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[200px]">
                      {officer.processData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={officer.processData}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              label={({ name, value }) => `${name}: ${value}`}
                              outerRadius={60}
                              fill="#8884d8"
                              dataKey="value"
                            >
                              {officer.processData.map((_, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: 'hsl(var(--card))', 
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px'
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                          No inspections
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}

        {/* QA Officers - Time vs Inspections Chart */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5" />
                QA Officers - Time vs Inspections
              </CardTitle>
              <div className="flex items-center gap-2">
                {/* View Mode Toggle */}
                <div className="flex items-center border rounded-lg overflow-hidden">
                  <Button
                    variant={qaOfficerChartViewMode === "daily" ? "default" : "ghost"}
                    size="sm"
                    className="rounded-none h-8 text-xs"
                    onClick={() => setQaOfficerChartViewMode("daily")}
                  >
                    Daily
                  </Button>
                  <Button
                    variant={qaOfficerChartViewMode === "monthly" ? "default" : "ghost"}
                    size="sm"
                    className="rounded-none h-8 text-xs"
                    onClick={() => setQaOfficerChartViewMode("monthly")}
                  >
                    Monthly
                  </Button>
                </div>
                
                {/* Date Picker */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-2">
                      <CalendarIcon className="h-4 w-4" />
                      {qaOfficerChartViewMode === "daily" 
                        ? format(qaOfficerChartDate, "dd MMM yyyy")
                        : format(qaOfficerChartDate, "MMM yyyy")
                      }
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="single"
                      selected={qaOfficerChartDate}
                      onSelect={(date) => date && setQaOfficerChartDate(date)}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {(qaOfficerTimeData as any)?.chartData?.length > 0 ? (
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={(qaOfficerTimeData as any).chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="hour" 
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    {(qaOfficerTimeData as any).officers?.map((officer: string, index: number) => (
                      <Bar 
                        key={officer}
                        dataKey={officer} 
                        fill={QA_OFFICER_COLORS[index % QA_OFFICER_COLORS.length]}
                        stackId="a"
                        name={officer}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                No inspections found for the selected period
              </div>
            )}
          </CardContent>
        </Card>

        {/* Machine Operators - Time vs Inspections Chart */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Machine Operators - Time vs Inspections
              </CardTitle>
              <div className="flex items-center gap-2">
                {/* View Mode Toggle */}
                <div className="flex items-center border rounded-lg overflow-hidden">
                  <Button
                    variant={operatorChartViewMode === "daily" ? "default" : "ghost"}
                    size="sm"
                    className="rounded-none h-8 text-xs"
                    onClick={() => setOperatorChartViewMode("daily")}
                  >
                    Daily
                  </Button>
                  <Button
                    variant={operatorChartViewMode === "monthly" ? "default" : "ghost"}
                    size="sm"
                    className="rounded-none h-8 text-xs"
                    onClick={() => setOperatorChartViewMode("monthly")}
                  >
                    Monthly
                  </Button>
                </div>
                
                {/* Date Picker */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-2">
                      <CalendarIcon className="h-4 w-4" />
                      {operatorChartViewMode === "daily" 
                        ? format(operatorChartDate, "dd MMM yyyy")
                        : format(operatorChartDate, "MMM yyyy")
                      }
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="single"
                      selected={operatorChartDate}
                      onSelect={(date) => date && setOperatorChartDate(date)}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {(operatorTimeData as any)?.chartData?.length > 0 ? (
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={(operatorTimeData as any).chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="hour" 
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    {(operatorTimeData as any).operators?.map((operator: string, index: number) => (
                      <Bar 
                        key={operator}
                        dataKey={operator} 
                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                        stackId="a"
                        name={operator}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                No inspections found for the selected period
              </div>
            )}
          </CardContent>
        </Card>

        {/* Process Inspection Details Dialog */}
        <Dialog open={processDetailsDialogOpen} onOpenChange={setProcessDetailsDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5" />
                {selectedProcessName} - Inspection Details
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              {/* Date Filter Controls inside Dialog */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-muted/30 rounded-lg border">
                <div className="flex items-center gap-3">
                  {/* View Mode Toggle */}
                  <div className="flex items-center border rounded-lg overflow-hidden">
                    <Button
                      variant={processViewMode === "daily" ? "default" : "ghost"}
                      size="sm"
                      className="rounded-none h-8 text-xs"
                      onClick={() => setProcessViewMode("daily")}
                    >
                      Daily
                    </Button>
                    <Button
                      variant={processViewMode === "monthly" ? "default" : "ghost"}
                      size="sm"
                      className="rounded-none h-8 text-xs"
                      onClick={() => setProcessViewMode("monthly")}
                    >
                      Monthly
                    </Button>
                  </div>
                  
                  {/* Date Picker */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 gap-2">
                        <CalendarIcon className="h-4 w-4" />
                        {processViewMode === "daily" 
                          ? format(processSelectedDate, "dd MMM yyyy")
                          : format(processSelectedDate, "MMM yyyy")
                        }
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={processSelectedDate}
                        onSelect={(date) => date && setProcessSelectedDate(date)}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>

                  {/* Time Filter */}
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <input
                      type="time"
                      value={processTimeFrom}
                      onChange={(e) => setProcessTimeFrom(e.target.value)}
                      className="h-8 px-2 rounded-md border border-input bg-background text-sm w-[90px]"
                    />
                    <span className="text-muted-foreground text-xs">to</span>
                    <input
                      type="time"
                      value={processTimeTo}
                      onChange={(e) => setProcessTimeTo(e.target.value)}
                      className="h-8 px-2 rounded-md border border-input bg-background text-sm w-[90px]"
                    />
                    {(processTimeFrom || processTimeTo) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setProcessTimeFrom(""); setProcessTimeTo(""); }}
                        className="h-8 px-2 text-xs"
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </div>

                <span className="text-sm text-muted-foreground">
                  {selectedProcessInspections.length} inspections found
                </span>
              </div>

              {selectedProcessInspections.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Inspection #</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Shift</TableHead>
                      <TableHead>Parameters</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedProcessInspections.map((inspection) => {
                      const readings = readingsByInspection[inspection.id] || [];
                      return (
                        <TableRow key={inspection.id}>
                          <TableCell className="font-medium">{inspection.inspection_number}</TableCell>
                          <TableCell>{(inspection.grades as any)?.name || "-"}</TableCell>
                          <TableCell>{format(new Date(inspection.inspection_date), "dd MMM yyyy")}</TableCell>
                          <TableCell>
                            {inspection.created_at 
                              ? format(new Date(inspection.created_at), "HH:mm")
                              : "-"
                            }
                          </TableCell>
                          <TableCell>{inspection.shift || "-"}</TableCell>
                          <TableCell className="max-w-[300px]">
                            {readings.length > 0 ? (
                              <div className="space-y-1">
                                {readings.map((reading: any) => (
                                  <div key={reading.id} className="flex items-center gap-2 text-xs">
                                    <span className="font-medium text-muted-foreground">
                                      {reading.qa_process_parameters?.parameter_name || "Unknown"}:
                                    </span>
                                    <span className={cn(
                                      reading.is_within_spec === false ? "text-red-600 font-medium" : ""
                                    )}>
                                      {formatReadingValue(reading)}
                                    </span>
                                    {reading.is_within_spec === false && (
                                      <AlertCircle className="h-3 w-3 text-red-500" />
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">No parameters</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <StatusBadge 
                              status={
                                inspection.result === "pass" ? "approved" :
                                inspection.result === "fail" ? "rejected" : "pending"
                              } 
                            />
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate" title={inspection.remarks || ""}>
                            {inspection.remarks || "-"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No inspections found for this process
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
