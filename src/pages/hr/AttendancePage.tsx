import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Plus, Pencil, CalendarIcon, Download, Upload, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

const STATUSES = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "half_day", label: "Half Day" },
  { value: "late", label: "Late" },
  { value: "on_leave", label: "On Leave" },
];

interface AttendanceFormData {
  employee_id: string;
  attendance_date: Date;
  check_in: string;
  check_out: string;
  status: string;
  remarks: string;
}

export default function AttendancePage() {
  const queryClient = useQueryClient();
  const { hasRole, hasModulePermission } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const canImportExport = isSuperAdmin || (hasRole("manager") && hasModulePermission("hr", "view"));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [filterDate, setFilterDate] = useState<Date>(new Date());
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFromDate, setExportFromDate] = useState<Date>(new Date());
  const [exportToDate, setExportToDate] = useState<Date>(new Date());
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importDate, setImportDate] = useState<Date>(new Date());
  const [isExporting, setIsExporting] = useState(false);
  const [formData, setFormData] = useState<AttendanceFormData>({
    employee_id: "",
    attendance_date: new Date(),
    check_in: "",
    check_out: "",
    status: "present",
    remarks: "",
  });

  // Fetch employees
  const { data: employees = [] } = useQuery({
    queryKey: ["employees-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_code, full_name")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch attendance records
  const { data: attendance = [], isLoading } = useQuery({
    queryKey: ["attendance", format(filterDate, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("*, employees(employee_code, full_name)")
        .eq("attendance_date", format(filterDate, "yyyy-MM-dd"))
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Create/Update mutation
  const mutation = useMutation({
    mutationFn: async (data: AttendanceFormData & { id?: string }) => {
      const payload = {
        employee_id: data.employee_id,
        attendance_date: format(data.attendance_date, "yyyy-MM-dd"),
        check_in: data.check_in || null,
        check_out: data.check_out || null,
        status: data.status,
        remarks: data.remarks || null,
      };

      if (data.id) {
        const { error } = await supabase
          .from("attendance")
          .update(payload)
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("attendance").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast.success(selectedRecord ? "Attendance updated!" : "Attendance recorded!");
      setShowDialog(false);
      resetForm();
    },
    onError: (error: any) => {
      if (error.message?.includes("duplicate")) {
        toast.error("Attendance already exists for this employee on this date");
      } else {
        toast.error(error.message);
      }
    },
  });

  const resetForm = () => {
    setFormData({
      employee_id: "",
      attendance_date: new Date(),
      check_in: "",
      check_out: "",
      status: "present",
      remarks: "",
    });
    setSelectedRecord(null);
  };

  const handleAdd = () => {
    resetForm();
    setFormData(prev => ({ ...prev, attendance_date: filterDate }));
    setShowDialog(true);
  };

  const handleEdit = (record: any) => {
    setSelectedRecord(record);
    setFormData({
      employee_id: record.employee_id,
      attendance_date: new Date(record.attendance_date),
      check_in: record.check_in || "",
      check_out: record.check_out || "",
      status: record.status,
      remarks: record.remarks || "",
    });
    setShowDialog(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({ ...formData, id: selectedRecord?.id });
  };

  // Export attendance data to Excel with date range
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const fromStr = format(exportFromDate, "yyyy-MM-dd");
      const toStr = format(exportToDate, "yyyy-MM-dd");
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("attendance")
          .select("*, employees(employee_code, full_name)")
          .gte("attendance_date", fromStr)
          .lte("attendance_date", toStr)
          .order("attendance_date", { ascending: false })
          .range(from, from + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData = [...allData, ...data];
        if (data.length < batchSize) break;
        from += batchSize;
      }

      if (allData.length === 0) {
        toast.error("No attendance records found for selected date range");
        setIsExporting(false);
        return;
      }

      const rows = allData.map((r: any) => ({
        "Employee Code": r.employees?.employee_code || "",
        "Employee Name": r.employees?.full_name || "",
        "Date": r.attendance_date,
        "Check In": r.check_in || "",
        "Check Out": r.check_out || "",
        "Status": r.status,
        "Remarks": r.remarks || "",
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Attendance");
      XLSX.writeFile(wb, `Attendance_${fromStr}_to_${toStr}.xlsx`);
      toast.success(`Exported ${allData.length} records!`);
      setShowExportDialog(false);
    } catch (err: any) {
      toast.error("Export failed: " + err.message);
    }
    setIsExporting(false);
  };

  // Import attendance data from Excel with selected date
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);

      if (rows.length === 0) {
        toast.error("No data found in file");
        return;
      }

      // Build employee code -> id map
      const { data: emps } = await supabase
        .from("employees")
        .select("id, employee_code")
        .eq("is_active", true);
      const empMap = new Map((emps || []).map((e) => [e.employee_code, e.id]));

      let imported = 0;
      let skipped = 0;

      for (const row of rows) {
        const empCode = String(row["Employee Code"] || "").trim();
        const empId = empMap.get(empCode);
        if (!empId) { skipped++; continue; }

        const dateVal = row["Date"];
        let attDate: string;
        if (dateVal && typeof dateVal === "number") {
          const d = XLSX.SSF.parse_date_code(dateVal);
          attDate = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
        } else if (dateVal && String(dateVal).trim()) {
          attDate = String(dateVal).trim();
        } else {
          // Use selected import date as fallback
          attDate = format(importDate, "yyyy-MM-dd");
        }

        const status = String(row["Status"] || "present").toLowerCase().replace(/ /g, "_");
        const checkIn = String(row["Check In"] || "").trim() || null;
        const checkOut = String(row["Check Out"] || "").trim() || null;
        const remarks = String(row["Remarks"] || "").trim() || null;

        const { error } = await supabase.from("attendance").upsert(
          { employee_id: empId, attendance_date: attDate, check_in: checkIn, check_out: checkOut, status, remarks },
          { onConflict: "employee_id,attendance_date" }
        );
        if (error) { skipped++; } else { imported++; }
      }

      toast.success(`Imported ${imported} records, ${skipped} skipped`);
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      setShowImportDialog(false);
    } catch (err: any) {
      toast.error("Import failed: " + err.message);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

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
      key: "check_in",
      header: "Check In",
      render: (row: any) => row.check_in || "-",
    },
    {
      key: "check_out",
      header: "Check Out",
      render: (row: any) => row.check_out || "-",
    },
    {
      key: "status",
      header: "Status",
      render: (row: any) => <StatusBadge status={row.status} />,
    },
    {
      key: "remarks",
      header: "Remarks",
      render: (row: any) => row.remarks || "-",
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: any) => (
        <Button variant="ghost" size="icon" onClick={() => handleEdit(row)}>
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <ERPLayout>
      <div className="space-y-6">
         <PageHeader
           title="Attendance"
           description="Track daily employee attendance"
         >
           <div className="flex items-center gap-3">
              {canImportExport && (
                <>
                  <Button variant="outline" onClick={() => setShowExportDialog(true)}>
                    <Download className="h-4 w-4 mr-2" />
                    Export
                  </Button>
                  <Button variant="outline" onClick={() => setShowImportDialog(true)}>
                    <Upload className="h-4 w-4 mr-2" />
                    Import
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleImport}
                  />
                </>
              )}
              <Button variant="outline" size="icon" onClick={() => setFilterDate(prev => { const d = new Date(prev); d.setDate(d.getDate() - 1); return d; })}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[200px]">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(filterDate, "PPP")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={filterDate}
                    onSelect={(date) => date && setFilterDate(date)}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              <Button variant="outline" size="icon" onClick={() => setFilterDate(prev => { const d = new Date(prev); d.setDate(d.getDate() + 1); return d; })}>
                <ChevronRight className="h-4 w-4" />
              </Button>
             <Button onClick={handleAdd}>
               <Plus className="h-4 w-4 mr-2" />
               Mark Attendance
             </Button>
           </div>
         </PageHeader>

        <DataTable
          columns={columns}
          data={attendance}
          emptyMessage={`No attendance records for ${format(filterDate, "PP")}`}
        />

        {/* Attendance Dialog */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {selectedRecord ? "Edit Attendance" : "Mark Attendance"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Employee *</Label>
                <Select
                  value={formData.employee_id}
                  onValueChange={(v) => setFormData({ ...formData, employee_id: v })}
                  disabled={!!selectedRecord}
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
              </div>

              <div className="space-y-2">
                <Label>Date *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !formData.attendance_date && "text-muted-foreground"
                      )}
                      disabled={!!selectedRecord}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(formData.attendance_date, "PPP")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={formData.attendance_date}
                      onSelect={(date) => date && setFormData({ ...formData, attendance_date: date })}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Check In</Label>
                  <Input
                    type="time"
                    value={formData.check_in}
                    onChange={(e) => setFormData({ ...formData, check_in: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Check Out</Label>
                  <Input
                    type="time"
                    value={formData.check_out}
                    onChange={(e) => setFormData({ ...formData, check_out: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Status *</Label>
                <Select
                  value={formData.status}
                  onValueChange={(v) => setFormData({ ...formData, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Remarks</Label>
                <Textarea
                  value={formData.remarks}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                  placeholder="Any notes..."
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Export Dialog with Date Range */}
        <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Export Attendance</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>From Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(exportFromDate, "PPP")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={exportFromDate}
                      onSelect={(d) => d && setExportFromDate(d)}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>To Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(exportToDate, "PPP")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={exportToDate}
                      onSelect={(d) => d && setExportToDate(d)}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowExportDialog(false)}>Cancel</Button>
                <Button onClick={handleExport} disabled={isExporting}>
                  {isExporting ? "Exporting..." : "Export"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Import Dialog with Date Selection */}
        <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Import Attendance</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload an Excel file with columns: Employee Code, Check In, Check Out, Status, Remarks. 
                If the file has a "Date" column it will be used, otherwise the selected date below applies to all rows.
              </p>
              <div className="space-y-2">
                <Label>Default Date (for rows without Date column)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(importDate, "PPP")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={importDate}
                      onSelect={(d) => d && setImportDate(d)}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowImportDialog(false)}>Cancel</Button>
                <Button onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" />
                  Select File
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
