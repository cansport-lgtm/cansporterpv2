import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format, startOfMonth, endOfMonth, startOfDay, endOfDay } from "date-fns";
import { Calendar as CalendarIcon, List, User, Building2, Plus, Tag, Download, Sparkles, Loader2, ShieldCheck } from "lucide-react";
import * as XLSX from "xlsx";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
type ViewMode = "daily" | "monthly";

export default function ProcessInspectionsDashboard() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("daily");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedMonth, setSelectedMonth] = useState<Date>(new Date());
  const [selectedProcess, setSelectedProcess] = useState<string>("all");
  const [selectedPerson, setSelectedPerson] = useState<string>("all");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [selectedGrade, setSelectedGrade] = useState<string>("all");
  const [aiInsights, setAiInsights] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiProcessName, setAiProcessName] = useState("");
  const [aiFailRate, setAiFailRate] = useState(0);
  const [aiComplianceScore, setAiComplianceScore] = useState<number | null>(null);
  // Fetch processes filtered by department
  const { data: processes = [] } = useQuery({
    queryKey: ["qa_processes", selectedDepartment],
    queryFn: async () => {
      let query = supabase
        .from("qa_processes")
        .select("id, name, code, sequence_order, department_id, is_export_allowed")
        .eq("is_active", true)
        .order("sequence_order");
      
      if (selectedDepartment !== "all") {
        query = query.eq("department_id", selectedDepartment);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Reset process selection when department changes
  const handleDepartmentChange = (value: string) => {
    setSelectedDepartment(value);
    setSelectedProcess("all");
  };

  // Fetch users who have entered inspections
  const { data: enteredByUsers = [] } = useQuery({
    queryKey: ["inspection_users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_users")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch departments
  const { data: departments = [] } = useQuery({
    queryKey: ["production_departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name, code")
        .eq("is_active", true)
        .order("sequence_order");
      if (error) throw error;
      return data;
    },
  });

  // Fetch grades
  const { data: grades = [] } = useQuery({
    queryKey: ["grades"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grades")
        .select("id, name, code")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return data;
    },
  });

  // Fetch inspections with readings based on view mode and filters
  const { data: inspections = [], isLoading } = useQuery({
    queryKey: ["process_inspections", viewMode, selectedDate, selectedMonth, selectedProcess, selectedPerson, selectedDepartment, selectedGrade],
    queryFn: async () => {
      let query = supabase
        .from("qa_inspections")
        .select(`
          id,
          inspection_number,
          inspection_date,
          created_at,
          result,
          grades(name, code),
          created_by_user:app_users!qa_inspections_created_by_fkey(id, full_name),
          qa_processes(id, name, code, sequence_order)
        `)
        .order("inspection_date", { ascending: false });

      // Apply date filter based on view mode
      if (viewMode === "daily") {
        const dayStart = format(startOfDay(selectedDate), "yyyy-MM-dd");
        const dayEnd = format(endOfDay(selectedDate), "yyyy-MM-dd");
        query = query.gte("inspection_date", dayStart).lte("inspection_date", dayEnd);
      } else {
        const monthStart = format(startOfMonth(selectedMonth), "yyyy-MM-dd");
        const monthEnd = format(endOfMonth(selectedMonth), "yyyy-MM-dd");
        query = query.gte("inspection_date", monthStart).lte("inspection_date", monthEnd);
      }

      // Apply process filter
      if (selectedProcess !== "all") {
        query = query.eq("process_id", selectedProcess);
      }

      // Apply person filter
      if (selectedPerson !== "all") {
        query = query.eq("created_by", selectedPerson);
      }

      // Apply department filter
      if (selectedDepartment !== "all") {
        query = query.eq("department_id", selectedDepartment);
      }

      // Apply grade filter
      if (selectedGrade !== "all") {
        query = query.eq("grade_id", selectedGrade);
      }

      const { data, error } = await query;
      if (error) throw error;

      const filteredData = data || [];

      // Fetch readings for all inspections in batches to avoid URL length and row limits
      if (filteredData && filteredData.length > 0) {
        const inspectionIds = filteredData.map((i: any) => i.id);
        const BATCH_SIZE = 50;
        const allReadings: any[] = [];
        
        for (let i = 0; i < inspectionIds.length; i += BATCH_SIZE) {
          const batchIds = inspectionIds.slice(i, i + BATCH_SIZE);
          const { data: readings, error: readingsError } = await supabase
            .from("qa_inspection_readings")
            .select(`
              inspection_id,
              value_boolean,
              value_number,
              value_text,
              is_within_spec,
              qa_process_parameters(parameter_name, parameter_type)
            `)
            .in("inspection_id", batchIds)
            .limit(5000);

          if (readingsError) throw readingsError;
          if (readings) allReadings.push(...readings);
        }

        // Map readings to inspections
        return filteredData.map((inspection: any) => ({
          ...inspection,
          readings: allReadings.filter((r) => r.inspection_id === inspection.id) || [],
        }));
      }

      return filteredData || [];
    },
  });

  // Group inspections by process
  const groupedByProcess = processes.map((process) => {
    const processInspections = inspections.filter(
      (insp: any) => insp.qa_processes?.id === process.id
    );
    const passCount = processInspections.filter((i: any) => i.result === "pass").length;
    const failCount = processInspections.filter((i: any) => i.result === "fail").length;
    const holdCount = processInspections.filter((i: any) => i.result === "hold").length;

    return {
      ...process,
      inspections: processInspections,
      total: processInspections.length,
      passCount,
      failCount,
      holdCount,
    };
  }).filter(p => p.total > 0 || selectedProcess === "all");

  const getResultBadge = (result: string | null) => {
    switch (result) {
      case "pass":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Pass</Badge>;
      case "fail":
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Fail</Badge>;
      case "hold":
        return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Hold</Badge>;
      default:
        return <Badge className="bg-muted text-muted-foreground">Pending</Badge>;
    }
  };

  const formatReadingValue = (reading: any) => {
    const paramType = reading.qa_process_parameters?.parameter_type;
    if (paramType === "boolean") {
      return reading.value_boolean ? "OK" : "Not Good";
    } else if (paramType === "number") {
      return reading.value_number?.toString() || "-";
    } else {
      return reading.value_text || "-";
    }
  };

  const exportProcessToExcel = (processData: any) => {
    try {
      const rows = processData.inspections.map((insp: any) => {
        const row: Record<string, any> = {
          "Inspection #": insp.inspection_number,
          "Date": format(new Date(insp.inspection_date), "dd MMM yyyy"),
          "Time": insp.created_at ? format(new Date(insp.created_at), "hh:mm a") : "-",
          "Grade": insp.grades?.code || insp.grades?.name || "-",
          "Result": insp.result || "Pending",
          "Entered By": insp.created_by_user?.full_name || "-",
        };
        if (insp.readings) {
          insp.readings.forEach((r: any) => {
            const name = r.qa_process_parameters?.parameter_name || "Param";
            row[name] = formatReadingValue(r);
            row[`${name} (Spec)`] = r.is_within_spec === false ? "Out of Spec" : "OK";
          });
        }
        return row;
      });
      if (rows.length === 0) {
        toast.error("No inspection data to export");
        return;
      }
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, processData.name?.substring(0, 31) || "Process");
      XLSX.writeFile(wb, `${processData.code}_${processData.name}_Inspections.xlsx`);
      toast.success("Exported successfully");
    } catch {
      toast.error("Export failed");
    }
  };

  const handleAiInsights = async (processData: any) => {
    setAiProcessName(`${processData.code} - ${processData.name}`);
    setAiInsights("");
    setAiComplianceScore(null);
    setAiDialogOpen(true);
    setAiLoading(true);

    try {
      // Gather readings data (limit to recent 100 for context)
      const recentReadings = processData.inspections
        .flatMap((insp: any) =>
          (insp.readings || []).map((r: any) => ({
            parameter: r.qa_process_parameters?.parameter_name || "Unknown",
            value: formatReadingValue(r),
            withinSpec: r.is_within_spec !== false,
          }))
        )
        .slice(0, 100);

      const dateRange = viewMode === "daily"
        ? format(selectedDate, "dd MMM yyyy")
        : `${format(startOfMonth(selectedMonth), "dd MMM yyyy")} - ${format(endOfMonth(selectedMonth), "dd MMM yyyy")}`;

      // Fetch process standards and instructions for AI context
      const [{ data: standardsData }, { data: instructionsData }] = await Promise.all([
        supabase
          .from("qa_process_standards")
          .select("standard_title, standard_description, standard_type, target_value, tolerance_range")
          .eq("process_id", processData.id)
          .eq("is_active", true),
        supabase
          .from("qa_process_instructions")
          .select("step_number, title, description, instruction_type")
          .eq("process_id", processData.id)
          .eq("is_active", true)
          .order("step_number"),
      ]);

      const { data, error } = await supabase.functions.invoke("qa-ai-insights", {
        body: {
          processName: processData.name,
          processCode: processData.code,
          dateRange,
          stats: {
            total: processData.total,
            pass: processData.passCount,
            fail: processData.failCount,
            hold: processData.holdCount,
          },
          readings: recentReadings,
          standards: standardsData || [],
          instructions: instructionsData || [],
        },
      });

      if (error) {
        throw error;
      }

      if (data?.error) {
        toast.error(data.error);
        setAiDialogOpen(false);
      } else {
        setAiInsights(data?.insights || "No insights generated.");
        setAiFailRate(data?.failRate || 0);
        setAiComplianceScore(data?.complianceScore ?? null);
      }
    } catch (err: any) {
      console.error("AI insights error:", err);
      toast.error("Failed to generate AI insights");
      setAiDialogOpen(false);
    } finally {
      setAiLoading(false);
    }
  };


  const months = [
    { value: "0", label: "January" },
    { value: "1", label: "February" },
    { value: "2", label: "March" },
    { value: "3", label: "April" },
    { value: "4", label: "May" },
    { value: "5", label: "June" },
    { value: "6", label: "July" },
    { value: "7", label: "August" },
    { value: "8", label: "September" },
    { value: "9", label: "October" },
    { value: "10", label: "November" },
    { value: "11", label: "December" },
  ];

  const years = Array.from({ length: 5 }, (_, i) => {
    const year = new Date().getFullYear() - 2 + i;
    return { value: year.toString(), label: year.toString() };
  });

  // Mobile inspection card component
  const InspectionCard = ({ inspection }: { inspection: any }) => (
    <div className="border rounded-lg p-4 space-y-3 bg-card">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">{inspection.inspection_number}</span>
        {getResultBadge(inspection.result)}
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-muted-foreground">Date:</span>{" "}
          <span className="font-medium">{format(new Date(inspection.inspection_date), "dd MMM yyyy")}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Time:</span>{" "}
          <span className="font-medium">{inspection.created_at ? format(new Date(inspection.created_at), "hh:mm a") : "-"}</span>
        </div>
        <div className="col-span-2">
          <span className="text-muted-foreground">Grade:</span>{" "}
          <span className="font-medium">{inspection.grades?.code || inspection.grades?.name || "-"}</span>
        </div>
      </div>
      <div>
        <span className="text-muted-foreground text-sm">Parameters:</span>
        <div className="flex flex-wrap gap-1 mt-1">
          {inspection.readings && inspection.readings.length > 0 ? (
            inspection.readings.map((reading: any, idx: number) => (
              <Badge
                key={idx}
                variant="outline"
                className={`text-xs ${
                  reading.is_within_spec === false
                    ? "bg-red-500/10 text-red-400 border-red-500/30"
                    : "bg-muted"
                }`}
              >
                {reading.qa_process_parameters?.parameter_name}: {formatReadingValue(reading)}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground text-xs">No parameters</span>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <ERPLayout>
      <div className="space-y-4 md:space-y-6">
        <PageHeader
          title="Process-wise Inspections"
          description="View inspection data grouped by process with daily/monthly filters"
        >
          <Button onClick={() => navigate("/qa/inspections", { state: { openNewInspection: true } })}>
            <Plus className="h-4 w-4 mr-2" />
            New Inspection
          </Button>
        </PageHeader>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4 md:pt-6">
            <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:gap-4 md:items-center">
              {/* View Mode Toggle */}
              <div className="flex gap-2">
                <Button
                  variant={viewMode === "daily" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("daily")}
                  className="flex-1 md:flex-none"
                >
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  Daily
                </Button>
                <Button
                  variant={viewMode === "monthly" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("monthly")}
                  className="flex-1 md:flex-none"
                >
                  <List className="h-4 w-4 mr-2" />
                  Monthly
                </Button>
              </div>

              {/* Date Selection */}
              {viewMode === "daily" ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full md:w-auto justify-start">
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {format(selectedDate, "PPP")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => date && setSelectedDate(date)}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              ) : (
                <div className="flex gap-2">
                  <Select
                    value={selectedMonth.getMonth().toString()}
                    onValueChange={(value) => {
                      const newDate = new Date(selectedMonth);
                      newDate.setMonth(parseInt(value));
                      setSelectedMonth(newDate);
                    }}
                  >
                    <SelectTrigger className="flex-1 md:w-[140px]">
                      <SelectValue placeholder="Month" />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map((month) => (
                        <SelectItem key={month.value} value={month.value}>
                          {month.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={selectedMonth.getFullYear().toString()}
                    onValueChange={(value) => {
                      const newDate = new Date(selectedMonth);
                      newDate.setFullYear(parseInt(value));
                      setSelectedMonth(newDate);
                    }}
                  >
                    <SelectTrigger className="w-[100px]">
                      <SelectValue placeholder="Year" />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((year) => (
                        <SelectItem key={year.value} value={year.value}>
                          {year.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Process, Department and Person Filters */}
              <div className="flex gap-2 flex-col sm:flex-row flex-wrap">
                {/* Department Filter */}
                <Select value={selectedDepartment} onValueChange={handleDepartmentChange}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <Building2 className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="All Departments" />
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

                {/* Process Filter */}
                <Select value={selectedProcess} onValueChange={setSelectedProcess}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder="All Processes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Processes</SelectItem>
                    {processes.map((process) => (
                      <SelectItem key={process.id} value={process.id}>
                        {process.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Entered By Filter */}
                <Select value={selectedPerson} onValueChange={setSelectedPerson}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <User className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="All Users" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    {enteredByUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Grade Filter */}
                <Select value={selectedGrade} onValueChange={setSelectedGrade}>
                  <SelectTrigger className="w-full sm:w-[140px]">
                    <Tag className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="All Grades" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Grades</SelectItem>
                    {grades.map((grade) => (
                      <SelectItem key={grade.id} value={grade.id}>
                        {grade.code} - {grade.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Process-wise Inspection Tables */}
        {isLoading ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Loading inspection data...
            </CardContent>
          </Card>
        ) : groupedByProcess.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No inspections found for the selected period
            </CardContent>
          </Card>
        ) : (
          groupedByProcess.map((processData) => (
            <Card key={processData.id}>
              <CardHeader className="pb-3 px-4 md:px-6">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                   <CardTitle className="text-base md:text-lg flex items-center gap-2">
                     <span className="text-primary">{processData.code}</span>
                     <span>-</span>
                     <span>{processData.name}</span>
                     {processData.inspections.length > 0 && processData.is_export_allowed && (
                       <Button
                          variant="outline"
                          size="sm"
                          className="ml-2 h-7 text-xs"
                          onClick={() => exportProcessToExcel(processData)}
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Export
                        </Button>
                      )}
                      {processData.inspections.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-1 h-7 text-xs"
                          onClick={() => handleAiInsights(processData)}
                          disabled={aiLoading}
                        >
                          {aiLoading ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3 mr-1" />
                          )}
                          AI Insights
                        </Button>
                      )}
                   </CardTitle>
                  <div className="flex flex-wrap gap-1 md:gap-2 text-xs md:text-sm">
                    <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">
                      Pass: {processData.passCount}
                    </Badge>
                    <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30">
                      Fail: {processData.failCount}
                    </Badge>
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30">
                      Hold: {processData.holdCount}
                    </Badge>
                    <Badge variant="outline" className="bg-muted text-muted-foreground">
                      Total: {processData.total}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 md:px-6">
                {processData.inspections.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-4">
                    No inspections for this process
                  </p>
                ) : (
                  <>
                    {/* Mobile Card View */}
                    <div className="md:hidden space-y-3">
                      {processData.inspections.map((inspection: any) => (
                        <InspectionCard key={inspection.id} inspection={inspection} />
                      ))}
                    </div>

                    {/* Desktop Table View */}
                    <div className="hidden md:block overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="whitespace-nowrap">Inspection #</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Time</TableHead>
                            <TableHead>Grade</TableHead>
                            <TableHead>Parameters</TableHead>
                            <TableHead>Result</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {processData.inspections.map((inspection: any) => (
                            <TableRow key={inspection.id}>
                              <TableCell className="font-medium whitespace-nowrap">
                                {inspection.inspection_number}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {format(new Date(inspection.inspection_date), "dd MMM yyyy")}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {inspection.created_at ? format(new Date(inspection.created_at), "hh:mm a") : "-"}
                              </TableCell>
                              <TableCell>
                                {inspection.grades?.code || inspection.grades?.name || "-"}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {inspection.readings && inspection.readings.length > 0 ? (
                                    inspection.readings.map((reading: any, idx: number) => (
                                      <Badge
                                        key={idx}
                                        variant="outline"
                                        className={
                                          reading.is_within_spec === false
                                            ? "bg-red-500/10 text-red-400 border-red-500/30"
                                            : "bg-muted"
                                        }
                                      >
                                        {reading.qa_process_parameters?.parameter_name}: {formatReadingValue(reading)}
                                      </Badge>
                                    ))
                                  ) : (
                                    <span className="text-muted-foreground text-sm">No parameters</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>{getResultBadge(inspection.result)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))
        )}

        {/* AI Insights Dialog */}
        <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" dir="rtl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                AI کوالٹی بصیرت — {aiProcessName}
              </DialogTitle>
            </DialogHeader>
            {aiLoading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-muted-foreground text-sm">انسپکشن ڈیٹا کا تجزیہ ہو رہا ہے...</p>
              </div>
            ) : (
              <>
                {/* Standard Compliance Score Card */}
                {aiComplianceScore !== null && (
                  <div className={`rounded-lg border p-4 mb-4 ${
                    aiComplianceScore >= 80 ? "border-green-500/30 bg-green-50 dark:bg-green-950/20" :
                    aiComplianceScore >= 50 ? "border-yellow-500/30 bg-yellow-50 dark:bg-yellow-950/20" :
                    "border-red-500/30 bg-red-50 dark:bg-red-950/20"
                  }`}>
                    <div className="flex items-center gap-3 mb-2" dir="ltr">
                      <ShieldCheck className={`h-6 w-6 ${
                        aiComplianceScore >= 80 ? "text-green-600" :
                        aiComplianceScore >= 50 ? "text-yellow-600" :
                        "text-red-600"
                      }`} />
                      <span className="text-sm font-medium text-muted-foreground">Standard Compliance Score</span>
                    </div>
                    <div className="flex items-center gap-4" dir="ltr">
                      <span className={`text-3xl font-bold ${
                        aiComplianceScore >= 80 ? "text-green-600" :
                        aiComplianceScore >= 50 ? "text-yellow-600" :
                        "text-red-600"
                      }`}>
                        {aiComplianceScore}%
                      </span>
                      <div className="flex-1">
                        <Progress 
                          value={aiComplianceScore} 
                          className={`h-3 ${
                            aiComplianceScore >= 80 ? "[&>div]:bg-green-500" :
                            aiComplianceScore >= 50 ? "[&>div]:bg-yellow-500" :
                            "[&>div]:bg-red-500"
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                )}
                {aiComplianceScore === null && aiInsights && (
                  <div className="rounded-lg border border-muted bg-muted/30 p-3 mb-4 text-center" dir="ltr">
                    <span className="text-sm text-muted-foreground">No inspection readings available for compliance scoring</span>
                  </div>
                )}

                <div className={`prose prose-sm max-w-none ${aiFailRate > 10 ? "text-destructive prose-headings:text-destructive prose-strong:text-destructive" : "dark:prose-invert"}`} dir="rtl">
                  {(() => {
                    const sections = aiInsights.split(/(?=^## )/m);
                    return sections.map((section: string, idx: number) => {
                      const isCompliance = section.toLowerCase().includes("## standards compliance");
                      return (
                        <div key={idx} className={isCompliance ? "text-blue-600 dark:text-blue-400 [&_h2]:text-blue-600 [&_h2]:dark:text-blue-400 [&_strong]:text-blue-600 [&_strong]:dark:text-blue-400" : ""}>
                          <ReactMarkdown>{section}</ReactMarkdown>
                        </div>
                      );
                    });
                  })()}
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
