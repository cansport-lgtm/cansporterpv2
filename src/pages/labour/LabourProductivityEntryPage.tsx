import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { Plus, Search, Pencil, Trash2, UserPlus, CheckCircle, ChevronsUpDown, Check, Printer, Upload, X, Loader2, Download, Clock, FileEdit } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent } from "@/components/ui/card";
import { EmployeeAvatar } from "@/components/labour/EmployeeAvatar";

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
  department_id: string | null;
  contact_number: string | null;
  monthly_salary: number | null;
  is_active: boolean;
  photo_url: string | null;
}

interface ProductivityEntry {
  id: string;
  employee_id: string;
  department_id: string;
  process_id: string | null;
  target_date: string;
  target_quantity: number;
  todays_target: number | null;
  actual_quantity: number;
  efficiency_percentage: number;
  shift: string;
  work_type: string;
  mph: number;
  remarks: string | null;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  overtime_amount: number | null;
  check_in: string | null;
  check_out: string | null;
  labour_employees?: { id: string; full_name: string; employee_code: string; category: string | null; joining_date: string | null; photo_url: string | null };
  production_departments?: { id: string; name: string; code: string };
  qa_processes?: { id: string; name: string; code: string };
  created_by_user?: { id: string; full_name: string };
}

const LabourProductivityEntryPage = () => {
  const queryClient = useQueryClient();
  const { user, hasRole, hasModulePermission } = useAuth();
  const isMobile = useIsMobile();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ProductivityEntry | null>(null);
  const [entryToDelete, setEntryToDelete] = useState<ProductivityEntry | null>(null);
  const [requestEditEntry, setRequestEditEntry] = useState<ProductivityEntry | null>(null);
  const [requestEditFields, setRequestEditFields] = useState<{
    target_quantity: number;
    process_id: string;
    department_id: string;
    mph: number;
  }>({ target_quantity: 0, process_id: "", department_id: "", mph: 12 });
  const [requestEditReason, setRequestEditReason] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterDepartment, setFilterDepartment] = useState("all");
  const [filterCreatedBy, setFilterCreatedBy] = useState("all");
  const [filterMode, setFilterMode] = useState<"date" | "month">("date");
  const [filterDate, setFilterDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [filterMonth, setFilterMonth] = useState(format(new Date(), "yyyy-MM"));

  // Excel import/export state
  const isSuperAdmin = hasRole("super_admin");
  const canImportExport = isSuperAdmin || hasRole("manager");
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const importTimesFileInputRef = useRef<HTMLInputElement>(null);
  const importCheckInFileInputRef = useRef<HTMLInputElement>(null);
  const importCheckOutFileInputRef = useRef<HTMLInputElement>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showImportTimesDialog, setShowImportTimesDialog] = useState(false);
  const [showImportCheckInDialog, setShowImportCheckInDialog] = useState(false);
  const [showImportCheckOutDialog, setShowImportCheckOutDialog] = useState(false);
  const [exportFromDate, setExportFromDate] = useState<Date>(new Date());
  const [exportToDate, setExportToDate] = useState<Date>(new Date());
  const [importDate, setImportDate] = useState<Date>(new Date());
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isImportingTimes, setIsImportingTimes] = useState(false);
  const [isImportingCheckIn, setIsImportingCheckIn] = useState(false);
  const [isImportingCheckOut, setIsImportingCheckOut] = useState(false);

  const [formData, setFormData] = useState({
    employee_id: "",
    department_id: "",
    process_id: "",
    target_date: format(new Date(), "yyyy-MM-dd"),
    target_quantity: 0,
    todays_target: 0,
    actual_quantity: 0,
    shift: "Day",
    work_type: "full_day",
    remarks: "",
    overtime_amount: 0,
    check_in: "",
    check_out: "",
  });

  const [employeeFormData, setEmployeeFormData] = useState({
    employee_code: "",
    full_name: "",
    department_id: "",
    contact_number: "",
    monthly_salary: 0,
    photo_url: "",
  });
  const [uploadingEmployeePhoto, setUploadingEmployeePhoto] = useState(false);
  const employeePhotoInputRef = useRef<HTMLInputElement>(null);
  const employeeDialogContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isEmployeeDialogOpen) return;

    requestAnimationFrame(() => {
      employeeDialogContentRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  }, [isEmployeeDialogOpen]);

  const handleEmployeePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be smaller than 2 MB");
      return;
    }

    try {
      setUploadingEmployeePhoto(true);
      const ext = file.name.split(".").pop() || "jpg";
      const codePart = (employeeFormData.employee_code || "emp").replace(/[^a-zA-Z0-9_-]/g, "");
      const path = `${codePart}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("labour-photos")
        .upload(path, file, { cacheControl: "3600", upsert: true });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("labour-photos").getPublicUrl(path);
      setEmployeeFormData((prev) => ({ ...prev, photo_url: data.publicUrl }));
      toast.success("Photo uploaded");
    } catch (error: any) {
      toast.error(error.message || "Upload failed");
    } finally {
      setUploadingEmployeePhoto(false);
      if (employeePhotoInputRef.current) employeePhotoInputRef.current.value = "";
    }
  };

  const { data: departments = [] } = useQuery({
    queryKey: ["production-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true)
        .neq("name", "Trainings")
        .order("sequence_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: labourEmployees = [], refetch: refetchEmployees } = useQuery({
    queryKey: ["labour-employees", formData.department_id],
    queryFn: async () => {
      let query = supabase
        .from("labour_employees")
        .select("*")
        .eq("is_active", true)
        .order("full_name");
      
      if (formData.department_id) {
        // Show employees in this department OR employees with no department assigned
        query = query.or(`department_id.eq.${formData.department_id},department_id.is.null`);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as LabourEmployee[];
    },
    enabled: true,
  });

  const { data: processes = [] } = useQuery({
    queryKey: ["qa-processes", formData.department_id],
    queryFn: async () => {
      let query = supabase
        .from("qa_processes")
        .select("id, name, code, department_id")
        .eq("is_active", true)
        .order("sequence_order");
      
      if (formData.department_id) {
        query = query.eq("department_id", formData.department_id);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Fetch process targets for auto-population
  const { data: processTargets = [] } = useQuery({
    queryKey: ["labour-process-targets-active"],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("labour_process_targets")
        .select("*")
        .eq("is_active", true)
        .lte("effective_from", today)
        .or(`effective_to.is.null,effective_to.gte.${today}`);
      if (error) throw error;
      return data;
    },
  });

  // Processes & employees scoped to the Request Edit dialog (independent of the Add/Edit form's department filter)
  const { data: requestEditProcesses = [] } = useQuery({
    queryKey: ["labour-request-edit-processes", requestEditFields.department_id],
    enabled: !!requestEditEntry && !!requestEditFields.department_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_processes")
        .select("id, name, code, department_id")
        .eq("is_active", true)
        .eq("department_id", requestEditFields.department_id)
        .order("sequence_order");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: requestEditEmployees = [] } = useQuery({
    queryKey: ["labour-request-edit-employees", requestEditFields.department_id],
    enabled: !!requestEditEntry,
    queryFn: async () => {
      let q = supabase
        .from("labour_employees")
        .select("id, full_name, employee_code, department_id")
        .eq("is_active", true)
        .order("full_name");
      if (requestEditFields.department_id) {
        q = q.or(`department_id.eq.${requestEditFields.department_id},department_id.is.null`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  // Function to get target for a process based on work type
  const getProcessTarget = (processId: string, departmentId: string, workType: string) => {
    if (!processId) return 0;
    
    // First try to find a target for the specific department
    let target = processTargets.find(
      (t) => t.process_id === processId && t.department_id === departmentId
    );
    
    // If not found, look for a target without department (applies to all)
    if (!target) {
      target = processTargets.find(
        (t) => t.process_id === processId && !t.department_id
      );
    }
    
    if (!target) return 0;
    
    return workType === "full_day" ? target.full_day_target : target.half_day_target;
  };

  // Fetch users who have created entries (for filter dropdown)
  const { data: entryCreators = [] } = useQuery({
    queryKey: ["labour-entry-creators"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labour_productivity_targets")
        .select("created_by, created_by_user:app_users!labour_productivity_targets_created_by_fkey(id, full_name)")
        .not("created_by", "is", null);
      if (error) throw error;
      
      // Get unique creators
      const uniqueCreators = new Map<string, { id: string; full_name: string }>();
      data?.forEach((entry: any) => {
        if (entry.created_by_user && !uniqueCreators.has(entry.created_by)) {
          uniqueCreators.set(entry.created_by, entry.created_by_user);
        }
      });
      
      return Array.from(uniqueCreators.values()).sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
  });

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["labour-productivity-entries", filterDepartment, filterDate, filterMonth, filterMode, filterCreatedBy],
    queryFn: async () => {
      let query = supabase
        .from("labour_productivity_targets")
        .select(`
          *,
          labour_employees(id, full_name, employee_code, category, joining_date, photo_url),
          production_departments(id, name, code),
          qa_processes(id, name, code),
          created_by_user:app_users!labour_productivity_targets_created_by_fkey(id, full_name)
        `)
        .order("created_at", { ascending: false });

      // Apply date filter based on mode
      if (filterMode === "date") {
        query = query.eq("target_date", filterDate);
      } else {
        const monthStart = format(startOfMonth(new Date(filterMonth + "-01")), "yyyy-MM-dd");
        const monthEnd = format(endOfMonth(new Date(filterMonth + "-01")), "yyyy-MM-dd");
        query = query.gte("target_date", monthStart).lte("target_date", monthEnd);
      }

      if (filterDepartment !== "all") {
        query = query.eq("department_id", filterDepartment);
      }

      if (filterCreatedBy !== "all") {
        query = query.eq("created_by", filterCreatedBy);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as ProductivityEntry[];
    },
  });

  // Map of entry_id -> pending edit request (for showing "Edit request pending" badge)
  const entryIdsForRequests = entries.map((e) => e.id);
  const { data: pendingRequestsByEntry = {} } = useQuery({
    queryKey: ["labour-edit-requests-pending-map", entryIdsForRequests],
    enabled: entryIdsForRequests.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labour_productivity_edit_requests" as any)
        .select("id, entry_id")
        .eq("status", "pending")
        .in("entry_id", entryIdsForRequests);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data || []).forEach((r: any) => { map[r.entry_id] = r.id; });
      return map;
    },
  });

  const submitEditRequestMutation = useMutation({
    mutationFn: async (payload: {
      entry: ProductivityEntry;
      requestedFields: typeof requestEditFields;
      reason: string;
    }) => {
      // Block if a pending request already exists for this entry
      const { data: existing, error: existingError } = await supabase
        .from("labour_productivity_edit_requests" as any)
        .select("id")
        .eq("entry_id", payload.entry.id)
        .eq("status", "pending")
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) {
        throw new Error("An edit request is already pending for this entry.");
      }

      // Build dynamic payload — only include fields that differ from the current entry
      const e = payload.entry;
      const f = payload.requestedFields;
      const insertPayload: any = {
        entry_id: e.id,
        requested_by: user?.id || null,
        reason: payload.reason,
        status: "pending",
        // snapshot only the 4 supported fields
        current_standard_target: e.target_quantity,
        current_process_id: e.process_id,
        current_department_id: e.department_id,
        current_mph: e.mph,
      };

      let hasChange = false;
      if (Number(f.target_quantity) !== Number(e.target_quantity)) {
        insertPayload.requested_standard_target = Number(f.target_quantity);
        hasChange = true;
      }
      if ((f.process_id || null) !== (e.process_id || null)) {
        insertPayload.requested_process_id = f.process_id || null;
        hasChange = true;
      }
      if ((f.department_id || null) !== (e.department_id || null)) {
        insertPayload.requested_department_id = f.department_id || null;
        hasChange = true;
      }
      if (Number(f.mph) !== Number(e.mph)) {
        insertPayload.requested_mph = Number(f.mph);
        hasChange = true;
      }

      if (!hasChange) {
        throw new Error("No fields changed — nothing to request.");
      }

      const { error } = await supabase
        .from("labour_productivity_edit_requests" as any)
        .insert(insertPayload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labour-edit-requests-pending-map"] });
      queryClient.invalidateQueries({ queryKey: ["labour-edit-requests"] });
      toast.success("Edit request submitted for approval");
      setRequestEditEntry(null);
      setRequestEditReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openRequestEditDialog = (entry: ProductivityEntry) => {
    setRequestEditEntry(entry);
    setRequestEditFields({
      target_quantity: Number(entry.target_quantity) || 0,
      process_id: entry.process_id || "",
      department_id: entry.department_id || "",
      mph: Number(entry.mph) === 6 ? 6 : 12,
    });
    setRequestEditReason("");
  };

  const handleSubmitEditRequest = () => {
    if (!requestEditEntry) return;
    if (!requestEditReason.trim()) {
      toast.error("Reason for edit is required");
      return;
    }
    submitEditRequestMutation.mutate({
      entry: requestEditEntry,
      requestedFields: requestEditFields,
      reason: requestEditReason.trim(),
    });
  };

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      // Calculate MPH for the new entry
      const newMph = data.work_type === "full_day" ? 12 : 6;
      
      // Check existing MPH for this employee on this date
      let existingQuery = supabase
        .from("labour_productivity_targets")
        .select("id, mph, work_type")
        .eq("employee_id", data.employee_id)
        .eq("target_date", data.target_date);
      
      // Exclude current entry if editing
      if (editingEntry) {
        existingQuery = existingQuery.neq("id", editingEntry.id);
      }
      
      const { data: existingEntries, error: checkError } = await existingQuery;
      if (checkError) throw checkError;
      
      const existingMph = (existingEntries || []).reduce((sum, entry) => sum + Number(entry.mph || 0), 0);
      const totalMph = existingMph + newMph;
      
      if (totalMph > 12) {
        throw new Error(`Worker already has ${existingMph} MPH on this date. Maximum allowed is 12 MPH per day.`);
      }

      const payload = {
        employee_id: data.employee_id,
        department_id: data.department_id,
        process_id: data.process_id || null,
        target_date: data.target_date,
        target_quantity: data.target_quantity,
        todays_target: data.todays_target || null,
        actual_quantity: data.actual_quantity,
        shift: data.shift,
        work_type: data.work_type,
        remarks: data.remarks || null,
        overtime_amount: data.overtime_amount || 0,
        check_in: data.check_in || null,
        check_out: data.check_out || null,
        created_by: user?.id || null,
      };

      if (editingEntry) {
        // Super admin can edit all fields; others can only update Actual Quantity and Reason
        const editPayload = isSuperAdmin
          ? payload
          : {
              actual_quantity: data.actual_quantity,
              remarks: data.remarks || null,
            };
        const { error } = await supabase
          .from("labour_productivity_targets")
          .update(editPayload)
          .eq("id", editingEntry.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("labour_productivity_targets")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labour-productivity-entries"] });
      toast.success(editingEntry ? "Entry updated" : "Entry created");
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save entry");
    },
  });

  const saveEmployeeMutation = useMutation({
    mutationFn: async (data: typeof employeeFormData) => {
      // Check for duplicate employee code
      const { data: existing } = await supabase
        .from("labour_employees")
        .select("id")
        .eq("employee_code", data.employee_code.trim())
        .maybeSingle();
      
      if (existing) {
        throw new Error("Employee code already exists. Please use a unique code.");
      }

      const { error } = await supabase
        .from("labour_employees")
        .insert({
          employee_code: data.employee_code.trim(),
          full_name: data.full_name.trim(),
          department_id: data.department_id || null,
          contact_number: data.contact_number?.trim() || null,
          monthly_salary: data.monthly_salary || 0,
          photo_url: data.photo_url || null,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labour-employees"] });
      toast.success("Employee added");
      setIsEmployeeDialogOpen(false);
      setEmployeeFormData({ employee_code: "", full_name: "", department_id: "", contact_number: "", monthly_salary: 0, photo_url: "" });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to add employee");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("labour_productivity_targets")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labour-productivity-entries"] });
      toast.success("Entry deleted");
      setDeleteDialogOpen(false);
      setEntryToDelete(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete entry");
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("labour_productivity_targets")
        .update({
          status: "approved",
          approved_by: user?.id || null,
          approved_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labour-productivity-entries"] });
      toast.success("Entry approved");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to approve entry");
    },
  });

  const resetForm = () => {
    setIsDialogOpen(false);
    setEditingEntry(null);
    setFormData({
      employee_id: "",
      department_id: "",
      process_id: "",
      target_date: format(new Date(), "yyyy-MM-dd"),
      target_quantity: 0,
      todays_target: 0,
      actual_quantity: 0,
      shift: "Day",
      work_type: "full_day",
      remarks: "",
      overtime_amount: 0,
      check_in: "",
      check_out: "",
    });
  };

  // Format Postgres time ("HH:mm:ss" or "HH:mm") to "HH:mm" for input/display
  const formatTime = (t: string | null | undefined): string => {
    if (!t) return "";
    const m = String(t).match(/^(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : "";
  };

  // Excel Export — date range, all columns including Check In / Check Out
  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      const fromStr = format(exportFromDate, "yyyy-MM-dd");
      const toStr = format(exportToDate, "yyyy-MM-dd");
      let all: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("labour_productivity_targets")
          .select(`
            target_date, shift, work_type, check_in, check_out,
            target_quantity, actual_quantity, status, remarks,
            labour_employees(employee_code, full_name),
            production_departments(name),
            qa_processes(name)
          `)
          .gte("target_date", fromStr)
          .lte("target_date", toStr)
          .order("target_date", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all = [...all, ...data];
        if (data.length < PAGE) break;
        from += PAGE;
      }

      if (all.length === 0) {
        toast.error("No entries found for selected date range");
        setIsExporting(false);
        return;
      }

      const rows = all.map((r: any) => ({
        "Employee Code": r.labour_employees?.employee_code || "",
        "Employee Name": r.labour_employees?.full_name || "",
        "Department": r.production_departments?.name || "",
        "Process": r.qa_processes?.name || "",
        "Date": r.target_date,
        "Shift": r.shift || "",
        "Work Type": r.work_type === "full_day" ? "Full Day" : r.work_type === "half_day" ? "Half Day" : (r.work_type || ""),
        "Check In": formatTime(r.check_in),
        "Check Out": formatTime(r.check_out),
        "Target Qty": r.target_quantity ?? 0,
        "Actual Qty": r.actual_quantity ?? 0,
        "Status": r.status || "draft",
        "Remarks": r.remarks || "",
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Productivity");
      XLSX.writeFile(wb, `Labour_Productivity_${fromStr}_to_${toStr}.xlsx`);
      toast.success(`Exported ${all.length} entries`);
      setShowExportDialog(false);
    } catch (err: any) {
      toast.error("Export failed: " + (err?.message || "Unknown error"));
    }
    setIsExporting(false);
  };

  // Excel Import — maps Employee Code, Department & Process names → IDs; upserts on unique key
  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);

      if (rows.length === 0) {
        toast.error("No data found in file");
        setIsImporting(false);
        return;
      }

      const { data: emps } = await supabase
        .from("labour_employees")
        .select("id, employee_code")
        .eq("is_active", true);
      const empMap = new Map((emps || []).map((e: any) => [String(e.employee_code).trim().toLowerCase(), e.id]));

      const { data: deps } = await supabase.from("production_departments").select("id, name");
      const depMap = new Map((deps || []).map((d: any) => [String(d.name).trim().toLowerCase(), d.id]));

      const { data: procs } = await supabase.from("qa_processes").select("id, name, department_id");
      const procMap = new Map<string, string>();
      (procs || []).forEach((p: any) => {
        procMap.set(`${p.department_id || ""}::${String(p.name).trim().toLowerCase()}`, p.id);
        procMap.set(`*::${String(p.name).trim().toLowerCase()}`, p.id);
      });

      let imported = 0;
      let skipped = 0;

      for (const row of rows) {
        const empCode = String(row["Employee Code"] || "").trim().toLowerCase();
        const empId = empMap.get(empCode);
        if (!empId) { skipped++; continue; }

        const depName = String(row["Department"] || "").trim().toLowerCase();
        const depId = depMap.get(depName);
        if (!depId) { skipped++; continue; }

        const procName = String(row["Process"] || "").trim().toLowerCase();
        const procId = procName ? (procMap.get(`${depId}::${procName}`) || procMap.get(`*::${procName}`) || null) : null;

        const dateVal = row["Date"];
        let targetDate: string;
        if (dateVal && typeof dateVal === "number") {
          const d = XLSX.SSF.parse_date_code(dateVal);
          targetDate = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
        } else if (dateVal && String(dateVal).trim()) {
          const s = String(dateVal).trim();
          const parsed = new Date(s);
          targetDate = isNaN(parsed.getTime()) ? format(importDate, "yyyy-MM-dd") : format(parsed, "yyyy-MM-dd");
        } else {
          targetDate = format(importDate, "yyyy-MM-dd");
        }

        const shift = String(row["Shift"] || "Day").trim() || "Day";
        const workTypeRaw = String(row["Work Type"] || "Full Day").trim().toLowerCase();
        const workType = workTypeRaw.includes("half") ? "half_day" : "full_day";
        const checkIn = formatTime(String(row["Check In"] || "").trim()) || null;
        const checkOut = formatTime(String(row["Check Out"] || "").trim()) || null;
        const targetQty = Number(row["Target Qty"]) || 0;
        const actualQty = Number(row["Actual Qty"]) || 0;
        const remarks = String(row["Remarks"] || "").trim() || null;

        const payload: any = {
          employee_id: empId,
          department_id: depId,
          process_id: procId,
          target_date: targetDate,
          shift,
          work_type: workType,
          check_in: checkIn,
          check_out: checkOut,
          target_quantity: targetQty,
          actual_quantity: actualQty,
          remarks,
          status: "draft",
          created_by: user?.id || null,
        };

        const { error } = await supabase
          .from("labour_productivity_targets")
          .upsert(payload, { onConflict: "employee_id,target_date,department_id,process_id" });
        if (error) { skipped++; } else { imported++; }
      }

      toast.success(`Imported ${imported} entries, ${skipped} skipped`);
      queryClient.invalidateQueries({ queryKey: ["labour-productivity-entries"] });
      setShowImportDialog(false);
    } catch (err: any) {
      toast.error("Import failed: " + (err?.message || "Unknown error"));
    }
    setIsImporting(false);
    if (importFileInputRef.current) importFileInputRef.current.value = "";
  };

  // Times-only Import — only patches check_in / check_out on existing entries
  const handleImportTimes = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImportingTimes(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);

      if (rows.length === 0) {
        toast.error("No data found in file");
        setIsImportingTimes(false);
        if (importTimesFileInputRef.current) importTimesFileInputRef.current.value = "";
        return;
      }

      // Build employee code → id map
      const { data: empList } = await (supabase as any)
        .from("labour_employees")
        .select("id, employee_code");
      const empMap = new Map<string, string>();
      (empList || []).forEach((e: any) => {
        if (e.employee_code) empMap.set(String(e.employee_code).trim().toLowerCase(), e.id);
      });

      const parseTime = (v: any): string | null => {
        if (v === null || v === undefined || v === "") return null;
        // Excel time as fraction of day
        if (typeof v === "number") {
          const totalSec = Math.round(v * 24 * 60 * 60);
          const hh = Math.floor(totalSec / 3600) % 24;
          const mm = Math.floor((totalSec % 3600) / 60);
          const ss = totalSec % 60;
          return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
        }
        const s = String(v).trim();
        const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
        if (!m) return null;
        return `${m[1].padStart(2, "0")}:${m[2]}:${m[3] || "00"}`;
      };

      let updated = 0;
      let skippedNoEntry = 0;
      let skippedUnknownEmp = 0;

      for (const row of rows) {
        const code = String(row["Employee Code"] || row["employee_code"] || "").trim().toLowerCase();
        if (!code) { skippedUnknownEmp++; continue; }
        const empId = empMap.get(code);
        if (!empId) { skippedUnknownEmp++; continue; }

        const dateVal = row["Date"] || row["date"];
        let targetDate: string | null = null;
        if (dateVal && typeof dateVal === "number") {
          const d = XLSX.SSF.parse_date_code(dateVal);
          targetDate = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
        } else if (dateVal && String(dateVal).trim()) {
          const parsed = new Date(String(dateVal).trim());
          if (!isNaN(parsed.getTime())) targetDate = format(parsed, "yyyy-MM-dd");
        }
        if (!targetDate) { skippedNoEntry++; continue; }

        const checkIn = parseTime(row["Check In"] ?? row["check_in"]);
        const checkOut = parseTime(row["Check Out"] ?? row["check_out"]);

        // Find existing entries
        const { data: existing } = await (supabase as any)
          .from("labour_productivity_targets")
          .select("id")
          .eq("employee_id", empId)
          .eq("target_date", targetDate);

        if (!existing || existing.length === 0) { skippedNoEntry++; continue; }

        const ids = existing.map((r: any) => r.id);
        const { error } = await (supabase as any)
          .from("labour_productivity_targets")
          .update({ check_in: checkIn, check_out: checkOut })
          .in("id", ids);
        if (error) { skippedNoEntry++; } else { updated += ids.length; }
      }

      toast.success(`Updated: ${updated} · Skipped (no entry): ${skippedNoEntry} · Skipped (unknown employee): ${skippedUnknownEmp}`);
      queryClient.invalidateQueries({ queryKey: ["labour-productivity-entries"] });
      setShowImportTimesDialog(false);
    } catch (err: any) {
      toast.error("Import failed: " + (err?.message || "Unknown error"));
    }
    setIsImportingTimes(false);
    if (importTimesFileInputRef.current) importTimesFileInputRef.current.value = "";
  };

  const downloadTimesSample = () => {
    const sample = [
      { "Employee Code": "EMP001", "Employee Name": "John Doe", "Date": format(new Date(), "yyyy-MM-dd"), "Check In": "09:00", "Check Out": "18:00" },
    ];
    const ws = XLSX.utils.json_to_sheet(sample);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Times");
    XLSX.writeFile(wb, "Labour_Times_Sample.xlsx");
  };

  const downloadCheckInSample = () => {
    const sample = [
      { "Employee Code": "EMP001", "Employee Name": "John Doe", "Date": format(new Date(), "yyyy-MM-dd"), "Check In": "09:00" },
    ];
    const ws = XLSX.utils.json_to_sheet(sample);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CheckIn");
    XLSX.writeFile(wb, "Labour_CheckIn_Sample.xlsx");
  };

  const downloadCheckOutSample = () => {
    const sample = [
      { "Employee Code": "EMP001", "Employee Name": "John Doe", "Date": format(new Date(), "yyyy-MM-dd"), "Check Out": "18:00" },
    ];
    const ws = XLSX.utils.json_to_sheet(sample);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CheckOut");
    XLSX.writeFile(wb, "Labour_CheckOut_Sample.xlsx");
  };

  // Single-column time importer (check_in OR check_out)
  const handleImportSingleTime = async (
    e: React.ChangeEvent<HTMLInputElement>,
    field: "check_in" | "check_out",
  ) => {
    const file = e.target.files?.[0];
    const inputRef = field === "check_in" ? importCheckInFileInputRef : importCheckOutFileInputRef;
    const setBusy = field === "check_in" ? setIsImportingCheckIn : setIsImportingCheckOut;
    const setDialogOpen = field === "check_in" ? setShowImportCheckInDialog : setShowImportCheckOutDialog;
    const colKeyA = field === "check_in" ? "Check In" : "Check Out";
    const colKeyB = field;
    const label = field === "check_in" ? "Check In" : "Check Out";

    if (!file) return;
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);

      if (rows.length === 0) {
        toast.error("No data found in file");
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
        return;
      }

      const { data: empList } = await (supabase as any)
        .from("labour_employees")
        .select("id, employee_code");
      const empMap = new Map<string, string>();
      (empList || []).forEach((emp: any) => {
        if (emp.employee_code) empMap.set(String(emp.employee_code).trim().toLowerCase(), emp.id);
      });

      const parseTime = (v: any): string | null => {
        if (v === null || v === undefined || v === "") return null;
        if (typeof v === "number") {
          const totalSec = Math.round(v * 24 * 60 * 60);
          const hh = Math.floor(totalSec / 3600) % 24;
          const mm = Math.floor((totalSec % 3600) / 60);
          const ss = totalSec % 60;
          return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
        }
        const s = String(v).trim();
        const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
        if (!m) return null;
        return `${m[1].padStart(2, "0")}:${m[2]}:${m[3] || "00"}`;
      };

      let updated = 0;
      let skippedNoEntry = 0;
      let skippedUnknownEmp = 0;
      let skippedNoTime = 0;

      for (const row of rows) {
        const code = String(row["Employee Code"] || row["employee_code"] || "").trim().toLowerCase();
        if (!code) { skippedUnknownEmp++; continue; }
        const empId = empMap.get(code);
        if (!empId) { skippedUnknownEmp++; continue; }

        const dateVal = row["Date"] || row["date"];
        let targetDate: string | null = null;
        if (dateVal && typeof dateVal === "number") {
          const d = XLSX.SSF.parse_date_code(dateVal);
          targetDate = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
        } else if (dateVal && String(dateVal).trim()) {
          const parsed = new Date(String(dateVal).trim());
          if (!isNaN(parsed.getTime())) targetDate = format(parsed, "yyyy-MM-dd");
        }
        if (!targetDate) { skippedNoEntry++; continue; }

        const timeVal = parseTime(row[colKeyA] ?? row[colKeyB]);
        if (!timeVal) { skippedNoTime++; continue; }

        const { data: existing } = await (supabase as any)
          .from("labour_productivity_targets")
          .select("id")
          .eq("employee_id", empId)
          .eq("target_date", targetDate);

        if (!existing || existing.length === 0) { skippedNoEntry++; continue; }

        const ids = existing.map((r: any) => r.id);
        const { error } = await (supabase as any)
          .from("labour_productivity_targets")
          .update({ [field]: timeVal })
          .in("id", ids);
        if (error) { skippedNoEntry++; } else { updated += ids.length; }
      }

      toast.success(
        `${label} updated: ${updated} · No entry: ${skippedNoEntry} · Unknown employee: ${skippedUnknownEmp} · No time: ${skippedNoTime}`,
      );
      queryClient.invalidateQueries({ queryKey: ["labour-productivity-entries"] });
      setDialogOpen(false);
    } catch (err: any) {
      toast.error("Import failed: " + (err?.message || "Unknown error"));
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleImportCheckIn = (e: React.ChangeEvent<HTMLInputElement>) => handleImportSingleTime(e, "check_in");
  const handleImportCheckOut = (e: React.ChangeEvent<HTMLInputElement>) => handleImportSingleTime(e, "check_out");


  const handlePrint = () => {
    const dateLabel = filterMode === "date" 
      ? format(new Date(filterDate), "dd MMM yyyy") 
      : format(new Date(filterMonth + "-01"), "MMMM yyyy");
    const deptLabel = filterDepartment === "all" 
      ? "All Departments" 
      : departments.find(d => d.id === filterDepartment)?.name || "";

    const rows = filteredEntries.map((item, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${item.labour_employees?.full_name || ""}<br/><small>${item.labour_employees?.employee_code || ""}</small></td>
        <td>${item.labour_employees?.category || "-"}</td>
        <td>${format(new Date(item.target_date), "dd MMM yyyy")}</td>
        <td>${item.production_departments?.name || "-"}</td>
        <td>${item.qa_processes?.name || "-"}</td>
        <td>${item.shift}</td>
        <td>${item.work_type === "full_day" ? "Full" : "Half"}</td>
        <td>${Number(item.mph)}</td>
        <td>${item.target_quantity}</td>
        <td>${item.todays_target || "-"}</td>
        <td>${item.actual_quantity}</td>
        <td>${Number(item.efficiency_percentage).toFixed(1)}%</td>
        <td>${Number(item.overtime_amount || 0).toLocaleString()}</td>
        <td>${item.remarks || "-"}</td>
      </tr>
    `).join("");

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>Labour Productivity - ${dateLabel}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 11px; margin: 10mm; }
        h2 { margin: 0 0 2px; font-size: 16px; }
        .sub { color: #666; margin-bottom: 10px; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
        th { background: #f5f5f5; font-weight: 600; }
        small { color: #888; }
        @media print { body { margin: 5mm; } }
      </style></head><body>
      <h2>Labour Productivity Entry</h2>
      <div class="sub">${dateLabel} | ${deptLabel} | Total: ${filteredEntries.length} entries</div>
      <table>
        <thead><tr>
          <th>#</th><th>Employee</th><th>Category</th><th>Date</th><th>Dept</th><th>Process</th>
          <th>Shift</th><th>Type</th><th>MPH</th><th>Std Target</th><th>Today's Target</th><th>Actual</th><th>Eff%</th><th>OT</th><th>Reason</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handleEdit = (entry: ProductivityEntry) => {
    setEditingEntry(entry);
    setFormData({
      employee_id: entry.employee_id,
      department_id: entry.department_id,
      process_id: entry.process_id || "",
      target_date: entry.target_date,
      target_quantity: entry.target_quantity,
      todays_target: entry.todays_target || 0,
      actual_quantity: entry.actual_quantity,
      shift: entry.shift || "Day",
      work_type: entry.work_type || "full_day",
      remarks: entry.remarks || "",
      overtime_amount: entry.overtime_amount || 0,
      check_in: formatTime(entry.check_in),
      check_out: formatTime(entry.check_out),
    });
    setIsDialogOpen(true);
  };

  const handleDelete = (entry: ProductivityEntry) => {
    setEntryToDelete(entry);
    setDeleteDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.employee_id || !formData.department_id || !formData.process_id) {
      toast.error("Please fill all required fields");
      return;
    }
    if (!formData.target_quantity || formData.target_quantity <= 0) {
      toast.error("Target quantity must be greater than 0");
      return;
    }
    if (formData.actual_quantity < 0) {
      toast.error("Actual quantity cannot be negative");
      return;
    }

    // If productivity is below 80%, reason is compulsory
    if (formData.target_quantity > 0) {
      const efficiency = (formData.actual_quantity / formData.target_quantity) * 100;
      if (efficiency < 80 && !formData.remarks.trim()) {
        toast.error("Reason is compulsory when productivity is below 80%. Please provide details.");
        return;
      }
    }

    // Floor incharge cannot add/edit entries older than 5 days
    if (hasRole("floor_incharge") && !hasRole("super_admin") && !hasRole("admin")) {
      const entryDate = new Date(formData.target_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      entryDate.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((today.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 5) {
        toast.error("You cannot add or edit entries older than 5 days");
        return;
      }
    }

    saveMutation.mutate(formData);
  };

  const handleEmployeeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeFormData.employee_code || !employeeFormData.full_name) {
      toast.error("Please fill in required fields");
      return;
    }
    saveEmployeeMutation.mutate(employeeFormData);
  };

  const getEfficiencyBadge = (efficiency: number) => {
    if (efficiency >= 100) return "default";
    if (efficiency >= 80) return "secondary";
    return "destructive";
  };

  const filteredEntries = entries.filter((entry) =>
    entry.labour_employees?.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.labour_employees?.employee_code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns: Column<ProductivityEntry>[] = [
    {
      key: "employee",
      header: "Employee",
      render: (item) => (
        <div className="flex items-center gap-2">
          <EmployeeAvatar name={item.labour_employees?.full_name} photoUrl={item.labour_employees?.photo_url} />
          <div>
            <p className="font-medium">{item.labour_employees?.full_name}</p>
            <p className="text-xs text-muted-foreground">{item.labour_employees?.employee_code}</p>
            {item.labour_employees?.category && (
              <p className="text-xs text-accent-foreground bg-accent/50 rounded px-1 py-0.5 inline-block mt-0.5 md:hidden">{item.labour_employees.category}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      className: "hidden md:table-cell",
      render: (item) => (
        <span className="text-sm text-muted-foreground">{item.labour_employees?.category || "-"}</span>
      ),
    },
    {
      key: "joining_date",
      header: "Joining Date",
      className: "hidden md:table-cell",
      render: (item) => (
        <span className="text-sm text-muted-foreground">
          {item.labour_employees?.joining_date ? format(new Date(item.labour_employees.joining_date), "dd MMM yyyy") : "-"}
        </span>
      ),
    },
    {
      key: "target_date",
      header: "Date",
      render: (item) => format(new Date(item.target_date), "dd MMM yyyy"),
    },
    {
      key: "department",
      header: "Department",
      render: (item) => item.production_departments?.name || "-",
    },
    {
      key: "process",
      header: "Process",
      render: (item) => item.qa_processes?.name || "-",
    },
    {
      key: "shift",
      header: "Shift",
    },
    {
      key: "work_type",
      header: "Work Type",
      render: (item) => (
        <Badge variant={item.work_type === "full_day" ? "default" : "secondary"}>
          {item.work_type === "full_day" ? "Full Day" : "Half Day"}
        </Badge>
      ),
    },
    {
      key: "check_in",
      header: "Check In",
      render: (item) => (
        <span className="text-sm font-mono">{formatTime(item.check_in) || "-"}</span>
      ),
    },
    {
      key: "check_out",
      header: "Check Out",
      render: (item) => (
        <span className="text-sm font-mono">{formatTime(item.check_out) || "-"}</span>
      ),
    },
    {
      key: "mph",
      header: "MPH",
      render: (item) => <span className="font-medium">{Number(item.mph)}</span>,
    },
    {
      key: "overtime_amount",
      header: "OT (Rs.)",
      render: (item) => (
        <span className={Number(item.overtime_amount) > 0 ? "font-medium text-primary" : "text-muted-foreground"}>
          {Number(item.overtime_amount || 0).toLocaleString()}
        </span>
      ),
    },
    {
      key: "target_quantity",
      header: "Std Target",
    },
    {
      key: "todays_target",
      header: "Today's Target",
      render: (item) => <span>{item.todays_target || "-"}</span>,
    },
    {
      key: "actual_quantity",
      header: "Actual",
    },
    {
      key: "efficiency",
      header: "Efficiency",
      render: (item) => (
        <Badge variant={getEfficiencyBadge(Number(item.efficiency_percentage))}>
          {Number(item.efficiency_percentage).toFixed(1)}%
        </Badge>
      ),
    },
    {
      key: "entry_by",
      header: "Entry By",
      render: (item) => (
        <span className="text-sm text-muted-foreground">
          {item.created_by_user?.full_name || "-"}
        </span>
      ),
    },
    ...(hasRole("floor_incharge") ? [{
      key: "remarks",
      header: "Reason",
      render: (item: ProductivityEntry) => (
        <span className="text-sm text-muted-foreground truncate max-w-[150px] block">
          {item.remarks || "-"}
        </span>
      ),
    }] : []),
    {
      key: "status",
      header: "Status",
      render: (item) => (
        <Badge variant={item.status === "approved" ? "default" : "secondary"}>
          {item.status === "approved" ? "Approved" : "Draft"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (item) => {
        const isDraft = item.status !== "approved";
        const isSuperAdminLocal = hasRole("super_admin");
        const isFloorIncharge = hasRole("floor_incharge");
        const isApprover = hasRole("labour_productivity_approver");
        const canEdit = isDraft;
        const canDelete = isSuperAdminLocal;
        const canApprove = isDraft && (isSuperAdminLocal || isApprover || (!isFloorIncharge && hasModulePermission("labour", "approve")));
        const hasPendingRequest = !!(pendingRequestsByEntry as Record<string, string>)[item.id];
        
        return (
          <div className="flex gap-1">
            {canApprove && (
              <Button 
                variant="ghost" 
                size="icon"
                className="text-primary"
                onClick={() => approveMutation.mutate(item.id)}
                title="Approve"
              >
                <CheckCircle className="h-4 w-4" />
              </Button>
            )}
            {canEdit && isSuperAdminLocal && (
              <Button variant="ghost" size="icon" onClick={() => handleEdit(item)} title="Edit">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canEdit && !isSuperAdminLocal && (
              <Button variant="ghost" size="icon" onClick={() => handleEdit(item)} title="Quick Edit (Actual Qty / Remarks)">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canEdit && !isSuperAdminLocal && !hasPendingRequest && (
              <Button variant="ghost" size="icon" onClick={() => openRequestEditDialog(item)} title="Request Edit for other fields">
                <FileEdit className="h-4 w-4 text-amber-600" />
              </Button>
            )}
            {canEdit && !isSuperAdminLocal && hasPendingRequest && (
              <Badge className="bg-amber-500 text-white">Edit request pending</Badge>
            )}
            {canDelete && (
              <Button variant="ghost" size="icon" onClick={() => handleDelete(item)} title="Delete">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
            {!canEdit && !canDelete && (
              <span className="text-xs text-muted-foreground px-2">Approved – locked</span>
            )}
          </div>
        );
      },
    },
  ];

  // Mobile card renderer
  const renderMobileCard = (item: ProductivityEntry) => {
    const isDraft = item.status !== "approved";
    const isSuperAdminLocal = hasRole("super_admin");
    const isFloorIncharge = hasRole("floor_incharge");
    const canEdit = isDraft;
    const canDelete = isSuperAdminLocal;
    const canApprove = isDraft && (isSuperAdminLocal || !isFloorIncharge);
    const hasPendingRequest = !!(pendingRequestsByEntry as Record<string, string>)[item.id];

    return (
      <Card key={item.id} className="mb-3">
        <CardContent className="p-4">
          <div className="flex justify-between items-start mb-3">
            <div className="flex items-center gap-2">
              <EmployeeAvatar name={item.labour_employees?.full_name} photoUrl={item.labour_employees?.photo_url} className="h-10 w-10" />
              <div>
                <p className="font-semibold text-base">{item.labour_employees?.full_name}</p>
                <p className="text-xs text-muted-foreground">{item.labour_employees?.employee_code}</p>
                {item.labour_employees?.category && (
                  <p className="text-xs text-accent-foreground bg-accent/50 rounded px-1.5 py-0.5 inline-block mt-1">{item.labour_employees.category}</p>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge variant={item.status === "approved" ? "default" : "secondary"}>
                {item.status === "approved" ? "Approved" : "Draft"}
              </Badge>
              <Badge variant={item.work_type === "full_day" ? "default" : "secondary"}>
                {item.work_type === "full_day" ? "Full Day" : "Half Day"}
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm mb-3">
            <div>
              <span className="text-muted-foreground">Department:</span>
              <p className="font-medium">{item.production_departments?.name || "-"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Process:</span>
              <p className="font-medium">{item.qa_processes?.name || "-"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Shift:</span>
              <p className="font-medium">{item.shift}</p>
            </div>
            <div>
              <span className="text-muted-foreground">MPH:</span>
              <p className="font-medium">{Number(item.mph)}</p>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 text-sm mb-3 bg-muted/50 p-2 rounded">
            <div className="text-center">
              <span className="text-muted-foreground text-xs">Std Target</span>
              <p className="font-semibold">{item.target_quantity}</p>
            </div>
            <div className="text-center">
              <span className="text-muted-foreground text-xs">Today's Target</span>
              <p className="font-semibold">{item.todays_target || "-"}</p>
            </div>
            <div className="text-center">
              <span className="text-muted-foreground text-xs">Actual</span>
              <p className="font-semibold">{item.actual_quantity}</p>
            </div>
            <div className="text-center">
              <span className="text-muted-foreground text-xs">Efficiency</span>
              <Badge variant={getEfficiencyBadge(Number(item.efficiency_percentage))} className="mt-0.5">
                {Number(item.efficiency_percentage).toFixed(1)}%
              </Badge>
            </div>
          </div>

          {(item.check_in || item.check_out) && (
            <div className="grid grid-cols-2 gap-2 text-sm mb-3">
              <div>
                <span className="text-muted-foreground text-xs">Check In</span>
                <p className="font-mono font-medium">{formatTime(item.check_in) || "-"}</p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Check Out</span>
                <p className="font-mono font-medium">{formatTime(item.check_out) || "-"}</p>
              </div>
            </div>
          )}

           {isFloorIncharge && item.remarks && (
            <div className="text-sm mb-3">
              <span className="text-muted-foreground">Reason:</span>
              <p className="font-medium">{item.remarks}</p>
            </div>
          )}

          {item.created_by_user?.full_name && (
            <p className="text-xs text-muted-foreground mb-3">
              Entry by: {item.created_by_user.full_name}
            </p>
          )}

          <div className="flex gap-2 pt-2 border-t">
            {canApprove && (
              <Button 
                variant="outline" 
                size="sm"
                className="flex-1 text-primary"
                onClick={() => approveMutation.mutate(item.id)}
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Approve
              </Button>
            )}
            {canEdit && isSuperAdminLocal && (
              <Button variant="outline" size="sm" className="flex-1" onClick={() => handleEdit(item)}>
                <Pencil className="h-4 w-4 mr-1" />
                Edit
              </Button>
            )}
            {canEdit && !isSuperAdminLocal && (
              <Button variant="outline" size="sm" className="flex-1" onClick={() => handleEdit(item)}>
                <Pencil className="h-4 w-4 mr-1" />
                Quick Edit
              </Button>
            )}
            {canEdit && !isSuperAdminLocal && !hasPendingRequest && (
              <Button variant="outline" size="sm" className="flex-1" onClick={() => openRequestEditDialog(item)}>
                <FileEdit className="h-4 w-4 mr-1 text-amber-600" />
                Request Edit
              </Button>
            )}
            {canEdit && !isSuperAdminLocal && hasPendingRequest && (
              <Badge className="bg-amber-500 text-white flex-1 justify-center py-1.5">Edit request pending</Badge>
            )}
            {canDelete && (
              <Button variant="outline" size="sm" onClick={() => handleDelete(item)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
            {!canEdit && !canDelete && (
              <span className="text-xs text-muted-foreground">Approved – locked</span>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Labour Productivity Entry"
        description={isMobile ? undefined : "Record daily worker targets and actual output"}
        action={{
          label: isMobile ? "Add" : "Add Entry",
          onClick: () => setIsDialogOpen(true),
          icon: Plus,
        }}
      />

      {/* Filters - Responsive */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-4">
        <div className="relative flex-1 sm:flex-none">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search employee..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 w-full sm:w-[200px]"
          />
        </div>
        <div className="flex gap-2 flex-1 sm:flex-none">
          <Select value={filterMode} onValueChange={(v) => setFilterMode(v as "date" | "month")}>
            <SelectTrigger className="w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">Date</SelectItem>
              <SelectItem value="month">Month</SelectItem>
            </SelectContent>
          </Select>
          {filterMode === "date" ? (
            <Input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="flex-1 sm:w-[150px]"
            />
          ) : (
            <Input
              type="month"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="flex-1 sm:w-[150px]"
            />
          )}
          <Select value={filterDepartment} onValueChange={setFilterDepartment}>
            <SelectTrigger className="flex-1 sm:w-[180px]">
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
          <Select value={filterCreatedBy} onValueChange={setFilterCreatedBy}>
            <SelectTrigger className="flex-1 sm:w-[160px]">
              <SelectValue placeholder="Entry By" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {entryCreators.map((creator) => (
                <SelectItem key={creator.id} value={creator.id}>
                  {creator.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 w-full sm:w-auto flex-wrap">
          <Button variant="outline" onClick={handlePrint} className="flex-1 sm:flex-none">
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
          {canImportExport && (
            <>
              <Button variant="outline" onClick={() => setShowImportCheckInDialog(true)} className="flex-1 sm:flex-none">
                <Clock className="h-4 w-4 mr-2" />
                Import Check In
              </Button>
              <Button variant="outline" onClick={() => setShowImportCheckOutDialog(true)} className="flex-1 sm:flex-none">
                <Clock className="h-4 w-4 mr-2" />
                Import Check Out
              </Button>
              <input
                ref={importFileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleImportExcel}
              />
              <input
                ref={importTimesFileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleImportTimes}
              />
              <input
                ref={importCheckInFileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleImportCheckIn}
              />
              <input
                ref={importCheckOutFileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleImportCheckOut}
              />
            </>
          )}
          <Button variant="outline" onClick={() => setIsEmployeeDialogOpen(true)} className="flex-1 sm:flex-none">
            <UserPlus className="h-4 w-4 mr-2" />
            Add Employee
          </Button>
        </div>
      </div>

      {/* Responsive Data Display */}
      {isMobile ? (
        <div className="space-y-2">
          {filteredEntries.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                No entries found
              </CardContent>
            </Card>
          ) : (
            filteredEntries.map(renderMobileCard)
          )}
        </div>
      ) : (
        <DataTable columns={columns} data={filteredEntries} emptyMessage="No entries found" />
      )}

      {/* Add/Edit Entry Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="top-3 max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1rem)] max-w-md translate-y-0 overflow-y-auto p-4 sm:top-[50%] sm:w-full sm:translate-y-[-50%] sm:p-6">
          <DialogHeader>
            <DialogTitle>{editingEntry ? "Edit Entry" : "Add Productivity Entry"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-3 sm:space-y-4">
              {editingEntry && !isSuperAdmin && (
                <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
                  Posted entries: only <strong>Actual Quantity</strong> and <strong>Reason</strong> can be edited.
                </div>
              )}
              {editingEntry && isSuperAdmin && (
                <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-foreground">
                  Super Admin: full edit access enabled. Standard Target is still managed in Process Targets.
                </div>
              )}
              <div>
                <Label>Date</Label>
                <Input
                  type="date"
                  value={formData.target_date}
                  onChange={(e) => setFormData({ ...formData, target_date: e.target.value })}
                  required
                  disabled={!!editingEntry && !isSuperAdmin}
                />
              </div>
              <div>
                <Label>Department</Label>
                <Select
                  value={formData.department_id}
                  onValueChange={(v) => setFormData({ ...formData, department_id: v, employee_id: "", process_id: "" })}
                  disabled={!!editingEntry && !isSuperAdmin}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id}>
                        {dept.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Process</Label>
                <Select
                  value={formData.process_id}
                  onValueChange={(v) => {
                    const newTarget = getProcessTarget(v, formData.department_id, formData.work_type);
                    setFormData({ ...formData, process_id: v, target_quantity: newTarget || formData.target_quantity });
                  }}
                  disabled={(!!editingEntry && !isSuperAdmin) || !formData.department_id || processes.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={!formData.department_id ? "Select department first" : processes.length === 0 ? "No processes available" : "Select process"} />
                  </SelectTrigger>
                  <SelectContent>
                    {processes.map((proc) => (
                      <SelectItem key={proc.id} value={proc.id}>
                        {proc.code} - {proc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Employee</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className={cn(
                        "w-full justify-between",
                        !formData.employee_id && "text-muted-foreground"
                      )}
                      disabled={(!!editingEntry && !isSuperAdmin) || labourEmployees.length === 0}
                    >
                      {formData.employee_id
                        ? (() => {
                            const emp = labourEmployees.find((e) => e.id === formData.employee_id);
                            return emp ? `${emp.employee_code} - ${emp.full_name}` : "Select employee";
                          })()
                        : labourEmployees.length === 0
                        ? "No employees found"
                        : "Search employee..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[250px] max-w-[300px] p-0" align="start" side="bottom" avoidCollisions={true} sideOffset={4}>
                    <Command>
                      <CommandInput placeholder="Type name to search..." autoFocus />
                      <CommandList>
                        <CommandEmpty>No employee found.</CommandEmpty>
                        <CommandGroup>
                          {labourEmployees.map((emp) => (
                            <CommandItem
                              key={emp.id}
                              value={`${emp.employee_code} ${emp.full_name}`}
                              onSelect={() => {
                                setFormData({ ...formData, employee_id: emp.id });
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  formData.employee_id === emp.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {emp.employee_code} - {emp.full_name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <Label>Shift</Label>
                  <Select
                    value={formData.shift}
                    onValueChange={(v) => setFormData({ ...formData, shift: v })}
                    disabled={!!editingEntry && !isSuperAdmin}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select shift" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Day">Day</SelectItem>
                      <SelectItem value="Night">Night</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Work Type</Label>
                  <Select
                    value={formData.work_type}
                    onValueChange={(v) => {
                      const newTarget = getProcessTarget(formData.process_id, formData.department_id, v);
                      setFormData({ ...formData, work_type: v, target_quantity: newTarget || formData.target_quantity });
                    }}
                    disabled={!!editingEntry && !isSuperAdmin}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select work type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full_day">Full Day (12 MPH)</SelectItem>
                      <SelectItem value="half_day">Half Day (6 MPH)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                <div>
                  <Label>Standard Target</Label>
                  <Input
                    type="number"
                    min="0"
                    value={formData.target_quantity}
                    disabled
                    readOnly
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">Managed in Process Targets page</p>
                </div>
                <div>
                  <Label>Today's Target</Label>
                  <Input
                    type="number"
                    min="0"
                    value={formData.todays_target}
                    onChange={(e) => setFormData({ ...formData, todays_target: parseInt(e.target.value) || 0 })}
                    placeholder="0"
                    disabled={!!editingEntry && !isSuperAdmin}
                  />
                </div>
                <div>
                  <Label>Actual Quantity</Label>
                  <Input
                    type="number"
                    min="0"
                    value={formData.actual_quantity}
                    onChange={(e) => setFormData({ ...formData, actual_quantity: parseInt(e.target.value) || 0 })}
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <Label>Overtime Amount (Rs.)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={formData.overtime_amount}
                    onChange={(e) => setFormData({ ...formData, overtime_amount: parseFloat(e.target.value) || 0 })}
                    placeholder="0"
                    disabled={!!editingEntry && !isSuperAdmin}
                  />
                </div>
                <div className="col-span-2">
                  <Label>Reason {formData.target_quantity > 0 && formData.actual_quantity > 0 && ((formData.actual_quantity / formData.target_quantity) * 100) < 80 && <span className="text-destructive">*</span>}</Label>
                  <Textarea
                    value={formData.remarks}
                    onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                    placeholder="Enter reason in detail (compulsory if productivity is below 80%)"
                    rows={3}
                  />
                </div>
              </div>
            </div>
            <DialogFooter className="mt-6 flex-col-reverse gap-2 sm:flex-row sm:gap-0">
              <Button type="button" variant="outline" onClick={resetForm} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button type="submit" disabled={saveMutation.isPending} className="w-full sm:w-auto">
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Employee Dialog */}
      <Dialog open={isEmployeeDialogOpen} onOpenChange={setIsEmployeeDialogOpen}>
        <DialogContent
          ref={employeeDialogContentRef}
          className="top-3 max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1rem)] max-w-md translate-y-0 overflow-y-auto sm:top-[50%] sm:w-full sm:translate-y-[-50%]"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Add Labour Employee</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEmployeeSubmit}>
            <div className="space-y-4">
              {/* PROFILE PHOTO — first, full-width, unmissable */}
              <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <Label className="text-sm font-semibold">Profile Photo</Label>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Optional but recommended
                  </span>
                </div>
                <div className="flex flex-col items-center gap-3">
                  <EmployeeAvatar
                    name={employeeFormData.full_name}
                    photoUrl={employeeFormData.photo_url}
                    className="h-24 w-24 text-lg ring-2 ring-primary/40 ring-offset-2 ring-offset-background"
                  />
                  {!employeeFormData.photo_url && (
                    <p className="text-xs italic text-muted-foreground">No photo selected</p>
                  )}
                  <input
                    ref={employeePhotoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleEmployeePhotoUpload}
                  />
                  <div className="flex w-full flex-wrap justify-center gap-2">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => employeePhotoInputRef.current?.click()}
                      disabled={uploadingEmployeePhoto}
                      className="flex-1 sm:flex-none"
                    >
                      {uploadingEmployeePhoto ? (
                        <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Uploading...</>
                      ) : (
                        <><Upload className="mr-1.5 h-3.5 w-3.5" /> {employeeFormData.photo_url ? "Change Photo" : "Upload Photo"}</>
                      )}
                    </Button>
                    {employeeFormData.photo_url && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEmployeeFormData({ ...employeeFormData, photo_url: "" })}
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" /> Remove
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">JPG or PNG, max 2 MB</p>
                </div>
              </div>

              <div>
                <Label>Employee Code *</Label>
                <Input
                  value={employeeFormData.employee_code}
                  onChange={(e) => setEmployeeFormData({ ...employeeFormData, employee_code: e.target.value })}
                  placeholder="e.g., LAB-001"
                  required
                />
              </div>
              <div>
                <Label>Full Name *</Label>
                <Input
                  value={employeeFormData.full_name}
                  onChange={(e) => setEmployeeFormData({ ...employeeFormData, full_name: e.target.value })}
                  placeholder="Enter full name"
                  required
                />
              </div>
              <div>
                <Label>Department</Label>
                <Select
                  value={employeeFormData.department_id}
                  onValueChange={(v) => setEmployeeFormData({ ...employeeFormData, department_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id}>
                        {dept.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Contact Number</Label>
                <Input
                  value={employeeFormData.contact_number}
                  onChange={(e) => setEmployeeFormData({ ...employeeFormData, contact_number: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div>
                <Label>Monthly Salary (Rs.)</Label>
                <Input
                  type="number"
                  min="0"
                  value={employeeFormData.monthly_salary}
                  onChange={(e) => setEmployeeFormData({ ...employeeFormData, monthly_salary: parseFloat(e.target.value) || 0 })}
                  placeholder="Enter monthly salary"
                />
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsEmployeeDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saveEmployeeMutation.isPending}>
                {saveEmployeeMutation.isPending ? "Adding..." : "Add Employee"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Entry</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this productivity entry for{" "}
              {entryToDelete?.labour_employees?.full_name}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => entryToDelete && deleteMutation.mutate(entryToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Export Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Export Labour Productivity</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>From Date</Label>
              <Input
                type="date"
                value={format(exportFromDate, "yyyy-MM-dd")}
                onChange={(e) => e.target.value && setExportFromDate(new Date(e.target.value))}
              />
            </div>
            <div>
              <Label>To Date</Label>
              <Input
                type="date"
                value={format(exportToDate, "yyyy-MM-dd")}
                onChange={(e) => e.target.value && setExportToDate(new Date(e.target.value))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowExportDialog(false)}>Cancel</Button>
              <Button onClick={handleExportExcel} disabled={isExporting}>
                {isExporting ? "Exporting..." : "Export"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Import Labour Productivity</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload an Excel file with columns: Employee Code, Employee Name, Department, Process, Date, Shift, Work Type, Check In, Check Out, Target Qty, Actual Qty, Status, Remarks.
              Imported rows are saved as <strong>Draft</strong> (require approval).
            </p>
            <div>
              <Label>Default Date (used if Date column is missing)</Label>
              <Input
                type="date"
                value={format(importDate, "yyyy-MM-dd")}
                onChange={(e) => e.target.value && setImportDate(new Date(e.target.value))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowImportDialog(false)}>Cancel</Button>
              <Button onClick={() => importFileInputRef.current?.click()} disabled={isImporting}>
                <Upload className="h-4 w-4 mr-2" />
                {isImporting ? "Importing..." : "Select File"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Times Dialog */}
      <Dialog open={showImportTimesDialog} onOpenChange={setShowImportTimesDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Import Check-In / Check-Out Times</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Excel columns: <strong>Employee Code, Employee Name, Date, Check In, Check Out</strong>.
              Only updates times on existing entries — quantities, process, shift, and approval status are preserved.
              Rows without a matching entry are skipped.
            </p>
            <button
              type="button"
              onClick={downloadTimesSample}
              className="text-xs text-primary underline hover:no-underline"
            >
              Download sample file
            </button>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowImportTimesDialog(false)}>Cancel</Button>
              <Button onClick={() => importTimesFileInputRef.current?.click()} disabled={isImportingTimes}>
                <Upload className="h-4 w-4 mr-2" />
                {isImportingTimes ? "Importing..." : "Select File"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Check In Dialog */}
      <Dialog open={showImportCheckInDialog} onOpenChange={setShowImportCheckInDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Import Check-In Times</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Excel columns: <strong>Employee Code, Date, Check In</strong>.
              Only updates the <strong>Check In</strong> field on existing entries — Check Out and all other fields are preserved.
              Rows without a matching entry are skipped.
            </p>
            <button
              type="button"
              onClick={downloadCheckInSample}
              className="text-xs text-primary underline hover:no-underline"
            >
              Download sample file
            </button>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowImportCheckInDialog(false)}>Cancel</Button>
              <Button onClick={() => importCheckInFileInputRef.current?.click()} disabled={isImportingCheckIn}>
                <Upload className="h-4 w-4 mr-2" />
                {isImportingCheckIn ? "Importing..." : "Select File"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Check Out Dialog */}
      <Dialog open={showImportCheckOutDialog} onOpenChange={setShowImportCheckOutDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Import Check-Out Times</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Excel columns: <strong>Employee Code, Date, Check Out</strong>.
              Only updates the <strong>Check Out</strong> field on existing entries — Check In and all other fields are preserved.
              Rows without a matching entry are skipped.
            </p>
            <button
              type="button"
              onClick={downloadCheckOutSample}
              className="text-xs text-primary underline hover:no-underline"
            >
              Download sample file
            </button>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowImportCheckOutDialog(false)}>Cancel</Button>
              <Button onClick={() => importCheckOutFileInputRef.current?.click()} disabled={isImportingCheckOut}>
                <Upload className="h-4 w-4 mr-2" />
                {isImportingCheckOut ? "Importing..." : "Select File"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!requestEditEntry} onOpenChange={(open) => { if (!open) { setRequestEditEntry(null); setRequestEditReason(""); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Request Edit Approval</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
              Use this form to request changes to <strong>Department, Process, Today Target, or MPH</strong>.
              Actual Quantity and Remarks can be edited directly via Quick Edit (no approval needed).
              This request will be sent to the Super Admin for approval.
            </div>

            <div className="rounded border bg-muted/40 p-3 text-xs space-y-1">
              <p className="font-semibold">Current entry snapshot</p>
              <p>Date: <span className="font-medium">{requestEditEntry?.target_date}</span></p>
              <p>Department: <span className="font-medium">{requestEditEntry?.production_departments?.name || "-"}</span></p>
              <p>Process: <span className="font-medium">{requestEditEntry?.qa_processes?.name || "-"}</span></p>
              <p>Employee: <span className="font-medium">{requestEditEntry?.labour_employees?.full_name || "-"}</span></p>
              <p>Today Target: <span className="font-medium">{requestEditEntry?.target_quantity ?? 0}</span></p>
              <p>MPH: <span className="font-medium">{requestEditEntry?.mph ?? 0}</span></p>
            </div>

            <div className="space-y-2">
              <Label>Requested Department</Label>
              <Select
                value={requestEditFields.department_id}
                onValueChange={(v) => setRequestEditFields({ ...requestEditFields, department_id: v, process_id: "" })}
              >
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {departments.map((d: any) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Requested Process</Label>
              <Select
                value={requestEditFields.process_id}
                onValueChange={(v) => setRequestEditFields({ ...requestEditFields, process_id: v })}
              >
                <SelectTrigger><SelectValue placeholder="Select process" /></SelectTrigger>
                <SelectContent>
                  {requestEditProcesses.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Requested Today Target</Label>
              <Input
                type="number"
                min={0}
                step="any"
                value={requestEditFields.target_quantity}
                onChange={(e) => setRequestEditFields({ ...requestEditFields, target_quantity: Number(e.target.value) })}
              />
            </div>

            <div className="space-y-2">
              <Label>Requested MPH</Label>
              {/* MPH is derived from the work type — a full day is 12 and a half day is 6.
                  Nothing else is a valid value, so this offers the same two choices the
                  daily entry form does rather than a free number field. */}
              <Select
                value={String(requestEditFields.mph)}
                onValueChange={(v) => setRequestEditFields({ ...requestEditFields, mph: Number(v) })}
              >
                <SelectTrigger><SelectValue placeholder="Select MPH" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="12">Full Day (12 MPH)</SelectItem>
                  <SelectItem value="6">Half Day (6 MPH)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Reason for Edit <span className="text-destructive">*</span></Label>
              <Textarea
                value={requestEditReason}
                onChange={(e) => setRequestEditReason(e.target.value)}
                rows={3}
                placeholder="Explain why this edit is needed (required)"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setRequestEditEntry(null); setRequestEditReason(""); }}>
                Cancel
              </Button>
              <Button onClick={handleSubmitEditRequest} disabled={submitEditRequestMutation.isPending}>
                {submitEditRequestMutation.isPending ? "Submitting…" : "Submit Request"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
};

export default LabourProductivityEntryPage;
