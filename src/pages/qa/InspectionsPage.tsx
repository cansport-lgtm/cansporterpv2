import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Plus, Eye, Search, Calendar, Trash2, QrCode } from "lucide-react";
import { InspectionQRScannerDialog } from "@/components/qa/InspectionQRScannerDialog";
import { InspectionTagPrint } from "@/components/qa/InspectionTagPrint";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { checkAndCreateFailureAlert } from "@/utils/qaAutoAlert";
import { useAuth } from "@/contexts/AuthContext";
import { Switch } from "@/components/ui/switch";

interface InspectionReading {
  parameter_id: string;
  parameter_name: string;
  parameter_type: string;
  unit: string;
  min_value: number | null;
  max_value: number | null;
  value_text: string;
  value_number: number | null;
  value_boolean: boolean;
  is_within_spec: boolean;
}

export default function InspectionsPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const { user } = useAuth();
  const [showDialog, setShowDialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showPrintTag, setShowPrintTag] = useState(false);
  const [lastSavedInspection, setLastSavedInspection] = useState<any>(null);
  const [inspectionToDelete, setInspectionToDelete] = useState<any>(null);
  const [selectedInspection, setSelectedInspection] = useState<any>(null);
  const [dateFilter, setDateFilter] = useState(format(new Date(), "yyyy-MM-dd"));
  const [monthFilter, setMonthFilter] = useState(format(new Date(), "yyyy-MM"));
  const [viewMode, setViewMode] = useState<"daily" | "monthly">("daily");
  const [searchTerm, setSearchTerm] = useState("");
  const [formStep, setFormStep] = useState(1);
  const [trackingNumber, setTrackingNumber] = useState("");
  
  const [formData, setFormData] = useState({
    process_id: "",
    department_id: "",
    grade_id: "",
    inspection_date: format(new Date(), "yyyy-MM-dd"),
    shift: "Day",
    result: "",
    remarks: "",
    fail_reason: "",
  });
  
  const [readings, setReadings] = useState<InspectionReading[]>([]);

  // Auto-open new inspection form when navigated with state
  useEffect(() => {
    if (location.state?.openNewInspection) {
      resetForm();
      setShowDialog(true);
      // Clear the state to prevent re-opening on subsequent renders
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Fetch inspections
  const { data: inspections = [], isLoading } = useQuery({
    queryKey: ["qa-inspections", viewMode, dateFilter, monthFilter],
    queryFn: async () => {
      let query = supabase
        .from("qa_inspections")
        .select(`
          *,
          qa_processes(name, code),
          production_departments(name),
          grades(name),
          inspector:app_users!qa_inspections_inspector_id_fkey(full_name),
          created_by_user:app_users!qa_inspections_created_by_fkey(full_name)
        `);
      
      if (viewMode === "daily") {
        query = query.eq("inspection_date", dateFilter);
      } else {
        const monthDate = new Date(monthFilter + "-01");
        const startDate = format(startOfMonth(monthDate), "yyyy-MM-dd");
        const endDate = format(endOfMonth(monthDate), "yyyy-MM-dd");
        query = query.gte("inspection_date", startDate).lte("inspection_date", endDate);
      }
      
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch processes
  const { data: processes = [] } = useQuery({
    queryKey: ["qa-processes-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_processes")
        .select("*")
        .eq("is_active", true)
        .order("sequence_order");
      if (error) throw error;
      return data;
    },
  });

  // Fetch departments
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
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

  // Fetch grades
  const { data: grades = [] } = useQuery({
    queryKey: ["grades"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grades")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch process parameters when process is selected
  const { data: processParameters = [] } = useQuery({
    queryKey: ["qa-process-parameters", formData.process_id],
    queryFn: async () => {
      if (!formData.process_id) return [];
      const { data, error } = await supabase
        .from("qa_process_parameters")
        .select("*")
        .eq("process_id", formData.process_id)
        .eq("is_active", true)
        .order("sequence_order");
      if (error) throw error;
      return data;
    },
    enabled: !!formData.process_id,
  });

  // Create inspection mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      // Get department_id from the selected process
      const selectedProcess = processes.find((p: any) => p.id === formData.process_id);
      const departmentId = selectedProcess?.department_id || null;
      
      // Create inspection
      const { data: inspection, error: inspError } = await supabase
        .from("qa_inspections")
        .insert({
          inspection_number: "",
          process_id: formData.process_id,
          department_id: departmentId,
          grade_id: formData.grade_id || null,
          inspection_date: formData.inspection_date,
          shift: formData.shift,
          result: formData.result as "pass" | "fail" | "hold",
          remarks: formData.result === "fail" && formData.fail_reason 
            ? `[Fail Reason]: ${formData.fail_reason}${formData.remarks ? `\n[Notes]: ${formData.remarks}` : ""}`
            : formData.remarks || null,
          inspector_id: user?.id || null,
          created_by: user?.id || null,
          status: "draft",
          tag_tracking_number: selectedProcess?.requires_inspection_tag ? trackingNumber || null : null,
        } as any)
        .select()
        .single();
      
      if (inspError) throw inspError;

      // Create readings
      if (readings.length > 0) {
        const readingsToInsert = readings.map(r => ({
          inspection_id: inspection.id,
          parameter_id: r.parameter_id,
          value_text: r.parameter_type === "text" ? r.value_text : null,
          value_number: r.parameter_type === "number" ? r.value_number : null,
          value_boolean: r.parameter_type === "boolean" ? r.value_boolean : null,
          is_within_spec: r.is_within_spec,
        }));
        
        const { error: readError } = await supabase
          .from("qa_inspection_readings")
          .insert(readingsToInsert);
        
        if (readError) throw readError;
      }

      return inspection;
    },
    onSuccess: (inspection) => {
      queryClient.invalidateQueries({ queryKey: ["qa-inspections"] });
      toast.success("Inspection created successfully!");
      const selectedProcess = processes.find((p: any) => p.id === formData.process_id);
      
      // Auto-alert on repeated failures
      if (formData.result === "fail" && selectedProcess) {
        checkAndCreateFailureAlert(formData.process_id, selectedProcess.name, formData.inspection_date);
      }
      
      if (selectedProcess?.requires_inspection_tag) {
        setLastSavedInspection({
          ...inspection,
          processName: selectedProcess.name,
        });
        setShowDialog(false);
        setShowPrintTag(true);
        // Don't resetForm yet — wait until print dialog closes
      } else {
        resetForm();
        setFormStep(1);
      }
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  // Delete inspection mutation
  const deleteMutation = useMutation({
    mutationFn: async (inspectionId: string) => {
      // First delete associated readings
      await supabase.from("qa_inspection_readings").delete().eq("inspection_id", inspectionId);
      // Then delete the inspection
      const { error } = await supabase.from("qa_inspections").delete().eq("id", inspectionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-inspections"] });
      toast.success("Inspection deleted successfully!");
      setShowDeleteDialog(false);
      setInspectionToDelete(null);
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      process_id: "",
      department_id: "",
      grade_id: "",
      inspection_date: format(new Date(), "yyyy-MM-dd"),
      shift: "Day",
      result: "",
      remarks: "",
      fail_reason: "",
    });
    setReadings([]);
    setTrackingNumber("");
    setSelectedInspection(null);
    setFormStep(1);
  };

  const totalSteps = 3;

  // Filter processes by selected department
  const filteredProcesses = formData.department_id 
    ? processes.filter((p: any) => p.department_id === formData.department_id)
    : [];

  const canProceedToNextStep = () => {
    switch (formStep) {
      case 1:
        return formData.department_id && formData.process_id && formData.grade_id;
      case 2:
        return true; // Parameters step - can always proceed
      case 3:
        // Result is required, and if fail, fail_reason is required
        if (!formData.result) return false;
        if (formData.result === "fail" && !formData.fail_reason.trim()) return false;
        return true;
      default:
        return true;
    }
  };

  const handleNextStep = () => {
    if (canProceedToNextStep() && formStep < totalSteps) {
      setFormStep(formStep + 1);
    }
  };

  const handlePrevStep = () => {
    if (formStep > 1) {
      setFormStep(formStep - 1);
    }
  };

  // Handle department change - reset process when department changes
  const handleDepartmentChange = (departmentId: string) => {
    setFormData({ ...formData, department_id: departmentId, process_id: "" });
    setReadings([]);
  };

  // Initialize readings when process is selected
  const handleProcessChange = (processId: string) => {
    setFormData({ ...formData, process_id: processId });
  };

  // Update readings when parameters load
  useEffect(() => {
    if (showDialog && formData.process_id) {
      if (processParameters.length > 0) {
        setReadings(
          processParameters.map((p: any) => ({
            parameter_id: p.id,
            parameter_name: p.parameter_name,
            parameter_type: p.parameter_type,
            unit: p.unit || "",
            min_value: p.min_value,
            max_value: p.max_value,
            value_text: "",
            value_number: null,
            value_boolean: false,
            is_within_spec: true,
          }))
        );
      } else {
        // Clear readings when no parameters for the process
        setReadings([]);
      }
    }
  }, [processParameters, showDialog, formData.process_id]);

  const updateReading = (index: number, field: keyof InspectionReading, value: any) => {
    const updated = [...readings];
    updated[index] = { ...updated[index], [field]: value };
    
    // Check if within spec for number type
    if (field === "value_number" && updated[index].parameter_type === "number") {
      const min = updated[index].min_value;
      const max = updated[index].max_value;
      const val = value as number;
      updated[index].is_within_spec = 
        (min === null || val >= min) && (max === null || val <= max);
    }
    
    setReadings(updated);
  };

  const handleViewInspection = async (inspection: any) => {
    setSelectedInspection(inspection);
    
    // Fetch readings for this inspection
    const { data: readingsData } = await supabase
      .from("qa_inspection_readings")
      .select("*, qa_process_parameters(parameter_name, parameter_type, unit, min_value, max_value)")
      .eq("inspection_id", inspection.id);
    
    if (readingsData) {
      setReadings(
        readingsData.map((r: any) => ({
          parameter_id: r.parameter_id,
          parameter_name: r.qa_process_parameters?.parameter_name || "",
          parameter_type: r.qa_process_parameters?.parameter_type || "text",
          unit: r.qa_process_parameters?.unit || "",
          min_value: r.qa_process_parameters?.min_value,
          max_value: r.qa_process_parameters?.max_value,
          value_text: r.value_text || "",
          value_number: r.value_number,
          value_boolean: r.value_boolean || false,
          is_within_spec: r.is_within_spec,
        }))
      );
    }
    
    setShowViewDialog(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Only submit if result is selected and we're on the final step
    if (formStep === 3 && formData.result) {
      createMutation.mutate();
    }
  };

  const handleDeleteInspection = (inspection: any) => {
    setInspectionToDelete(inspection);
    setShowDeleteDialog(true);
  };

  const confirmDelete = () => {
    if (inspectionToDelete?.id) {
      deleteMutation.mutate(inspectionToDelete.id);
    }
  };

  const filteredInspections = inspections.filter((insp: any) =>
    insp.inspection_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    insp.qa_processes?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns = [
    { key: "inspection_number", header: "Inspection #" },
    {
      key: "qa_processes.name",
      header: "Process",
      render: (row: any) => row.qa_processes?.name || "-",
    },
    {
      key: "production_departments.name",
      header: "Department",
      render: (row: any) => row.production_departments?.name || "-",
    },
    {
      key: "grades.name",
      header: "Grade",
      render: (row: any) => row.grades?.name || "-",
    },
    { key: "shift", header: "Shift" },
    {
      key: "created_by_user.full_name",
      header: "Entered By",
      render: (row: any) => row.created_by_user?.full_name || "-",
    },
    {
      key: "result",
      header: "Result",
      render: (row: any) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
          row.result === "pass" ? "bg-green-100 text-green-700" :
          row.result === "fail" ? "bg-red-100 text-red-700" :
          "bg-yellow-100 text-yellow-700"
        }`}>
          {row.result?.toUpperCase()}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row: any) => <StatusBadge status={row.status} />,
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: any) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => handleViewInspection(row)} title="View Details">
            <Eye className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleDeleteInspection(row)} title="Delete Inspection">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="QA Inspections"
          description="Daily quality inspection records"
        >
          <Button onClick={() => { resetForm(); setShowDialog(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            New Inspection
          </Button>
        </PageHeader>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2 bg-muted rounded-lg p-1">
            <Button
              variant={viewMode === "daily" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("daily")}
            >
              Daily
            </Button>
            <Button
              variant={viewMode === "monthly" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("monthly")}
            >
              Monthly
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            {viewMode === "daily" ? (
              <Input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="w-40"
              />
            ) : (
              <Input
                type="month"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="w-40"
              />
            )}
          </div>
          <div className="flex items-center gap-2 flex-1 max-w-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search inspections..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <DataTable
          columns={columns}
          data={filteredInspections}
          emptyMessage="No inspections found for this date."
        />

        {/* Create Inspection Dialog - Step-by-Step Wizard */}
        <Dialog open={showDialog} onOpenChange={(open) => {
          setShowDialog(open);
          if (!open) resetForm();
        }}>
          <DialogContent className="w-[95vw] max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle className="text-lg flex items-center justify-between">
                <span>New Inspection</span>
                <span className="text-sm font-normal text-muted-foreground">
                  Step {formStep} of {totalSteps}
                </span>
              </DialogTitle>
              {/* Progress bar */}
              <div className="flex gap-1 mt-2">
                {Array.from({ length: totalSteps }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${
                      idx < formStep ? "bg-primary" : "bg-muted"
                    }`}
                  />
                ))}
              </div>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-6 mt-4">
              {/* Step 1: Form Details (without Result) */}
              {formStep === 1 && (
                <div className="space-y-5">
                  <div className="text-center mb-6">
                    <h3 className="font-medium text-base">Inspection Details</h3>
                    <p className="text-sm text-muted-foreground">Enter inspection information</p>
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Department *</Label>
                      <Select
                        value={formData.department_id}
                        onValueChange={handleDepartmentChange}
                      >
                        <SelectTrigger className="h-12 text-base">
                          <SelectValue placeholder="Select department" />
                        </SelectTrigger>
                        <SelectContent>
                          {departments.map((dept: any) => (
                            <SelectItem key={dept.id} value={dept.id} className="py-3">
                              {dept.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Process *</Label>
                      <Select
                        value={formData.process_id}
                        onValueChange={handleProcessChange}
                        disabled={!formData.department_id}
                      >
                        <SelectTrigger className="h-12 text-base">
                          <SelectValue placeholder={formData.department_id ? "Select process" : "Select department first"} />
                        </SelectTrigger>
                        <SelectContent>
                          {filteredProcesses.map((proc: any) => (
                            <SelectItem key={proc.id} value={proc.id} className="py-3">
                              {proc.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Grade *</Label>
                      <Select
                        value={formData.grade_id}
                        onValueChange={(v) => setFormData({ ...formData, grade_id: v })}
                      >
                        <SelectTrigger className="h-12 text-base">
                          <SelectValue placeholder="Select grade" />
                        </SelectTrigger>
                        <SelectContent>
                          {grades.map((grade: any) => (
                            <SelectItem key={grade.id} value={grade.id} className="py-3">
                              {grade.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Inspection Date</Label>
                      <Input
                        type="date"
                        className="h-12 text-base"
                        value={formData.inspection_date}
                        onChange={(e) => setFormData({ ...formData, inspection_date: e.target.value })}
                      />
                    </div>
                    {/* Tracking Number - shown when process requires inspection tag */}
                    {formData.process_id && processes.find((p: any) => p.id === formData.process_id)?.requires_inspection_tag && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Tracking Number</Label>
                        <div className="flex gap-2">
                          <Input
                            className="h-12 text-base flex-1 font-mono"
                            value={trackingNumber}
                            onChange={(e) => setTrackingNumber(e.target.value)}
                            placeholder="Scan or enter tracking number"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            className="h-12 px-3"
                            onClick={() => setShowQRScanner(true)}
                          >
                            <QrCode className="h-5 w-5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 2: Parameters Entry */}
              {formStep === 2 && (
                <div className="space-y-5">
                  <div className="text-center mb-4">
                    <h3 className="font-medium text-base">Parameters</h3>
                    <p className="text-sm text-muted-foreground">Enter inspection readings (optional)</p>
                  </div>
                  
                  {readings.length > 0 ? (
                    <div className="space-y-3">
                      {readings.map((reading, idx) => (
                        <div key={idx} className="p-3 bg-muted/30 rounded-lg space-y-2">
                          <div className="flex justify-between items-center">
                            <Label className="text-sm font-medium">{reading.parameter_name}</Label>
                            {reading.unit && <span className="text-xs text-muted-foreground">{reading.unit}</span>}
                          </div>
                          {reading.parameter_type === "boolean" ? (
                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                type="button"
                                variant={reading.value_boolean ? "default" : "outline"}
                                className={`h-10 ${reading.value_boolean ? "bg-green-600 hover:bg-green-700" : ""}`}
                                onClick={() => updateReading(idx, "value_boolean", true)}
                              >
                                OK
                              </Button>
                              <Button
                                type="button"
                                variant={!reading.value_boolean ? "default" : "outline"}
                                className={`h-10 ${!reading.value_boolean ? "bg-red-600 hover:bg-red-700" : ""}`}
                                onClick={() => updateReading(idx, "value_boolean", false)}
                              >
                                Not Good
                              </Button>
                            </div>
                          ) : reading.parameter_type === "number" ? (
                            <div>
                              <Input
                                type="number"
                                className="h-10"
                                value={reading.value_number ?? ""}
                                onChange={(e) => updateReading(idx, "value_number", e.target.value ? parseFloat(e.target.value) : null)}
                                placeholder={`${reading.min_value !== null ? `Min: ${reading.min_value}` : ""} ${reading.max_value !== null ? `Max: ${reading.max_value}` : ""}`}
                              />
                              {!reading.is_within_spec && (
                                <p className="text-xs text-destructive mt-1">Value out of specification</p>
                              )}
                            </div>
                          ) : (
                            <Input
                              type="text"
                              className="h-10"
                              value={reading.value_text}
                              onChange={(e) => updateReading(idx, "value_text", e.target.value)}
                              placeholder="Enter value"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>No parameters defined for this process.</p>
                      <p className="text-sm">You can proceed to set the result.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Result & Save */}
              {formStep === 3 && (
                <div className="space-y-5">
                  <div className="text-center mb-4">
                    <h3 className="font-medium text-base">Result & Save</h3>
                    <p className="text-sm text-muted-foreground">Select result and save inspection</p>
                  </div>
                  
                  {/* Summary */}
                  <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                    <h4 className="font-medium text-sm">Inspection Summary</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-muted-foreground">Process:</div>
                      <div>{processes.find((p: any) => p.id === formData.process_id)?.name || "-"}</div>
                      <div className="text-muted-foreground">Grade:</div>
                      <div>{grades.find((g: any) => g.id === formData.grade_id)?.name || "-"}</div>
                      <div className="text-muted-foreground">Date:</div>
                      <div>{formData.inspection_date}</div>
                    </div>
                    {formData.remarks && (
                      <div className="pt-2 border-t">
                        <div className="text-muted-foreground text-sm">Remarks:</div>
                        <div className="text-sm">{formData.remarks}</div>
                      </div>
                    )}
                  </div>

                  {readings.length > 0 && (
                    <div className="bg-muted/30 rounded-lg p-4 space-y-2">
                      <h4 className="font-medium text-sm">Parameters ({readings.length})</h4>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {readings.map((reading, idx) => (
                          <div key={idx} className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{reading.parameter_name}:</span>
                            <span className={!reading.is_within_spec ? "text-destructive" : ""}>
                              {reading.parameter_type === "boolean" 
                                ? (reading.value_boolean ? "OK" : "Not Good")
                                : reading.parameter_type === "number"
                                ? (reading.value_number ?? "-")
                                : (reading.value_text || "-")}
                              {reading.unit && ` ${reading.unit}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Remarks</Label>
                    <Textarea
                      value={formData.remarks}
                      onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                      placeholder="Enter any additional notes..."
                      rows={2}
                      className="min-h-[60px] text-base"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Result *</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {["pass", "fail", "hold"].map((result) => (
                        <Button
                          key={result}
                          type="button"
                          variant={formData.result === result ? "default" : "outline"}
                          className={`h-14 text-base capitalize ${
                            formData.result === result
                              ? result === "pass"
                                ? "bg-green-600 hover:bg-green-700"
                                : result === "fail"
                                ? "bg-red-600 hover:bg-red-700"
                                : "bg-yellow-600 hover:bg-yellow-700"
                              : ""
                          }`}
                          onClick={() => setFormData({ ...formData, result, fail_reason: result !== "fail" ? "" : formData.fail_reason })}
                        >
                          {result}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {formData.result === "fail" && (
                    <div className="space-y-2 p-4 bg-red-50 border border-red-200 rounded-lg">
                      <Label className="text-sm font-medium text-red-700">Reason for Fail *</Label>
                      <Textarea
                        value={formData.fail_reason}
                        onChange={(e) => setFormData({ ...formData, fail_reason: e.target.value })}
                        placeholder="Please provide the reason for failure..."
                        rows={3}
                        className="min-h-[80px] text-base border-red-300 focus:border-red-500"
                        required
                      />
                      {!formData.fail_reason.trim() && (
                        <p className="text-sm text-red-600">Reason is required when result is Fail</p>
                      )}
                    </div>
                  )}
                </div>
              )}


              {/* Navigation Buttons */}
              <div className="flex gap-2 pt-4 border-t">
                {formStep === 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 h-12"
                    onClick={() => setShowDialog(false)}
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 h-12"
                    onClick={handlePrevStep}
                  >
                    Back
                  </Button>
                )}
                
                {formStep < totalSteps ? (
                  <Button
                    type="button"
                    className="flex-1 h-12"
                    onClick={handleNextStep}
                    disabled={!canProceedToNextStep()}
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    className="flex-1 h-12 bg-green-600 hover:bg-green-700"
                    disabled={createMutation.isPending}
                  >
                    {createMutation.isPending ? "Saving..." : "Save Inspection"}
                  </Button>
                )}
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* View Inspection Dialog */}
        <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
          <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle className="text-lg">Inspection Details - {selectedInspection?.inspection_number}</DialogTitle>
            </DialogHeader>
            {selectedInspection && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs sm:text-sm">Process</p>
                    <p className="font-medium">{selectedInspection.qa_processes?.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs sm:text-sm">Department</p>
                    <p className="font-medium">{selectedInspection.production_departments?.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs sm:text-sm">Grade</p>
                    <p className="font-medium">{selectedInspection.grades?.name || "-"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs sm:text-sm">Date</p>
                    <p className="font-medium">{selectedInspection.inspection_date}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs sm:text-sm">Result</p>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      selectedInspection.result === "pass" ? "bg-green-100 text-green-700" :
                      selectedInspection.result === "fail" ? "bg-red-100 text-red-700" :
                      "bg-yellow-100 text-yellow-700"
                    }`}>
                      {selectedInspection.result?.toUpperCase()}
                    </span>
                  </div>
                  {(selectedInspection as any).tag_tracking_number && (
                    <div>
                      <p className="text-muted-foreground text-xs sm:text-sm">Tracking Number</p>
                      <p className="font-mono font-medium">{(selectedInspection as any).tag_tracking_number}</p>
                    </div>
                  )}
                </div>

                {readings.length > 0 && (
                  <div className="space-y-2">
                    <p className="font-semibold text-sm">Readings</p>
                    <div className="space-y-2">
                      {readings.map((reading, idx) => (
                        <div key={idx} className="flex justify-between items-center p-2 sm:p-3 bg-muted/50 rounded">
                          <span className="text-sm">{reading.parameter_name}</span>
                          <span className={`font-medium text-sm ${!reading.is_within_spec ? "text-destructive" : ""}`}>
                            {reading.parameter_type === "number" ? reading.value_number :
                             reading.parameter_type === "boolean" ? (reading.value_boolean ? "OK" : "Not Good") :
                             reading.value_text}
                            {reading.unit && ` ${reading.unit}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedInspection.remarks && (
                  <div>
                    <p className="text-muted-foreground text-xs sm:text-sm">Remarks</p>
                    <p className="text-sm">{selectedInspection.remarks}</p>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* QR Scanner Dialog */}
        <InspectionQRScannerDialog
          open={showQRScanner}
          onOpenChange={setShowQRScanner}
          onScanned={(value) => setTrackingNumber(value)}
        />

        {/* Print Tag Dialog */}
        {lastSavedInspection && (
          <InspectionTagPrint
            open={showPrintTag}
            onOpenChange={(open) => {
              setShowPrintTag(open);
              if (!open) {
                setLastSavedInspection(null);
                resetForm();
                setFormStep(1);
              }
            }}
            inspectionNumber={lastSavedInspection.inspection_number}
            trackingNumber={(lastSavedInspection as any).tag_tracking_number || ""}
            processName={lastSavedInspection.processName || ""}
            inspectionDate={lastSavedInspection.inspection_date}
            result={lastSavedInspection.result}
          />
        )}

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Inspection</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete inspection "{inspectionToDelete?.inspection_number}"? This will also delete all associated readings. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ERPLayout>
  );
}
