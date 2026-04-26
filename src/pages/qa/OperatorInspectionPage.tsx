import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { OperatorLayout } from "@/components/layout/OperatorLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import { checkAndCreateFailureAlert } from "@/utils/qaAutoAlert";
import { useAuth } from "@/contexts/AuthContext";
import { CheckCircle, QrCode } from "lucide-react";
import { ProcessInstructionsPanel } from "@/components/qa/ProcessInstructionsPanel";
import { InspectionQRScannerDialog } from "@/components/qa/InspectionQRScannerDialog";
import { InspectionTagPrint } from "@/components/qa/InspectionTagPrint";

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

export default function OperatorInspectionPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [formStep, setFormStep] = useState(1);
  const [showSuccess, setShowSuccess] = useState(false);
  const [formResetTrigger, setFormResetTrigger] = useState(0);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showPrintTag, setShowPrintTag] = useState(false);
  const [lastSavedInspection, setLastSavedInspection] = useState<any>(null);
  const [trackingNumber, setTrackingNumber] = useState("");
  
  const [formData, setFormData] = useState({
    department_id: "",
    process_id: "",
    grade_id: "",
    inspection_date: format(new Date(), "yyyy-MM-dd"),
    shift: "Day",
    result: "",
    remarks: "",
    fail_reason: "",
  });
  
  const [readings, setReadings] = useState<InspectionReading[]>([]);

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
      const selectedProcess = processes.find((p: any) => p.id === formData.process_id);
      const departmentId = selectedProcess?.department_id || null;
      
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
      toast.success("Inspection saved successfully!");
      
      const selectedProcess = processes.find((p: any) => p.id === formData.process_id);
      
      // Auto-alert on repeated failures
      if (formData.result === "fail" && selectedProcess) {
        checkAndCreateFailureAlert(formData.process_id, selectedProcess.name, formData.inspection_date);
      }
      const hasTag = selectedProcess?.requires_inspection_tag;
      if (hasTag) {
        setLastSavedInspection({
          ...inspection,
          processName: selectedProcess.name,
        });
      }
      
      // Show success overlay
      setShowSuccess(true);
      if (!hasTag) {
        setTimeout(() => {
          setShowSuccess(false);
          resetForm();
        }, 1500);
      }
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  // Filter processes by selected department
  const filteredProcesses = formData.department_id 
    ? processes.filter((p: any) => p.department_id === formData.department_id)
    : [];

  const resetForm = () => {
    // Retain the previous department and process for convenience
    const previousDepartmentId = formData.department_id;
    const previousProcessId = formData.process_id;
    setFormData({
      department_id: previousDepartmentId,
      process_id: previousProcessId,
      grade_id: "",
      inspection_date: format(new Date(), "yyyy-MM-dd"),
      shift: "Day",
      result: "",
      remarks: "",
      fail_reason: "",
    });
    setReadings([]);
    setTrackingNumber("");
    setFormStep(1);
    // Trigger re-population of parameters
    setFormResetTrigger(prev => prev + 1);
  };

  const totalSteps = 3;

  const canProceedToNextStep = () => {
    switch (formStep) {
      case 1:
        return formData.department_id && formData.process_id && formData.grade_id;
      case 2:
        return true;
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

  const handleProcessChange = (processId: string) => {
    setFormData({ ...formData, process_id: processId });
  };

  // Update readings when parameters load or form resets
  useEffect(() => {
    if (formData.process_id) {
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
        setReadings([]);
      }
    }
  }, [processParameters, formData.process_id, formResetTrigger]);

  const updateReading = (index: number, field: keyof InspectionReading, value: any) => {
    const updated = [...readings];
    updated[index] = { ...updated[index], [field]: value };
    
    if (field === "value_number" && updated[index].parameter_type === "number") {
      const min = updated[index].min_value;
      const max = updated[index].max_value;
      const val = value as number;
      updated[index].is_within_spec = 
        (min === null || val >= min) && (max === null || val <= max);
    }
    
    setReadings(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formStep === 3 && formData.result) {
      createMutation.mutate();
    }
  };

  const handleClosePrintTag = (open: boolean) => {
    setShowPrintTag(open);
    if (!open) {
      setShowSuccess(false);
      setLastSavedInspection(null);
      resetForm();
    }
  };

  // Success overlay
  if (showSuccess) {
    return (
      <OperatorLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center space-y-4">
            <CheckCircle className="h-20 w-20 text-green-500 mx-auto animate-pulse" />
            <h2 className="text-2xl font-bold text-green-600">Saved!</h2>
            {lastSavedInspection ? (
              <>
                <p className="text-muted-foreground">Tap below to print the inspection tag</p>
                <Button
                  size="lg"
                  className="h-14 px-8 text-base"
                  onClick={() => setShowPrintTag(true)}
                >
                  <QrCode className="h-5 w-5 mr-2" /> Print Inspection Tag
                </Button>
                <Button
                  variant="ghost"
                  className="block mx-auto text-sm"
                  onClick={() => {
                    setShowSuccess(false);
                    setLastSavedInspection(null);
                    resetForm();
                  }}
                >
                  Skip & Next Inspection
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">Preparing next inspection...</p>
            )}
          </div>
        </div>

        {/* Print Tag Dialog rendered within success overlay */}
        {lastSavedInspection && (
          <InspectionTagPrint
            open={showPrintTag}
            onOpenChange={handleClosePrintTag}
            inspectionNumber={lastSavedInspection.inspection_number}
            trackingNumber={(lastSavedInspection as any).tag_tracking_number || ""}
            processName={lastSavedInspection.processName || ""}
            inspectionDate={lastSavedInspection.inspection_date}
            result={lastSavedInspection.result}
          />
        )}
      </OperatorLayout>
    );
  }

  return (
    <OperatorLayout>
      <div className="max-w-lg mx-auto">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center justify-between">
              <span>New Inspection</span>
              <span className="text-sm font-normal text-muted-foreground">
                Step {formStep} of {totalSteps}
              </span>
            </CardTitle>
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
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Step 1: Form Details */}
              {formStep === 1 && (
                <div className="space-y-5">
                  <div className="text-center mb-6">
                    <h3 className="font-medium text-base">Inspection Details</h3>
                    <p className="text-sm text-muted-foreground">Enter inspection information</p>
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Inspection Date</Label>
                      <Input
                        type="date"
                        className="h-12 text-base"
                        value={formData.inspection_date}
                        onChange={(e) => setFormData({ ...formData, inspection_date: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Department *</Label>
                      <Select
                        value={formData.department_id}
                        onValueChange={handleDepartmentChange}
                      >
                        <SelectTrigger className="h-12 text-base">
                          <SelectValue placeholder="Select department" />
                        </SelectTrigger>
                        <SelectContent position="popper" side="bottom" className="max-h-60">
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
                        <SelectContent position="popper" side="bottom" className="max-h-60">
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
                        <SelectContent position="popper" side="bottom" className="max-h-60">
                          {grades.map((grade: any) => (
                            <SelectItem key={grade.id} value={grade.id} className="py-3">
                              {grade.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                  {/* Process Instructions Panel */}
                  {formData.process_id && (
                    <ProcessInstructionsPanel processId={formData.process_id} />
                  )}
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
                      <div className="text-muted-foreground">Department:</div>
                      <div>{departments.find((d: any) => d.id === formData.department_id)?.name || "-"}</div>
                      <div className="text-muted-foreground">Process:</div>
                      <div>{processes.find((p: any) => p.id === formData.process_id)?.name || "-"}</div>
                      <div className="text-muted-foreground">Grade:</div>
                      <div>{grades.find((g: any) => g.id === formData.grade_id)?.name || "-"}</div>
                      <div className="text-muted-foreground">Date:</div>
                      <div>{formData.inspection_date}</div>
                    </div>
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

              {/* Navigation Buttons - No Cancel for operator */}
              <div className="flex gap-2 pt-4 border-t">
                {formStep > 1 && (
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
                    disabled={createMutation.isPending || !formData.result}
                  >
                    {createMutation.isPending ? "Saving..." : "Save Inspection"}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

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
            onOpenChange={setShowPrintTag}
            inspectionNumber={lastSavedInspection.inspection_number}
            trackingNumber={(lastSavedInspection as any).tag_tracking_number || ""}
            processName={lastSavedInspection.processName || ""}
            inspectionDate={lastSavedInspection.inspection_date}
            result={lastSavedInspection.result}
          />
        )}
      </div>
    </OperatorLayout>
  );
}
