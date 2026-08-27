import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Pencil, Trash2, Upload, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
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
  employee_type: "salary" | "daily_wages";
  per_day_wages: number | null;
  category: string | null;
  joining_date: string | null;
  attendance_allowance: number | null;
  photo_url: string | null;
  production_departments?: { id: string; name: string } | null;
}

const LabourEmployeesPage = () => {
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole('super_admin');
  const canEditCode =
    isSuperAdmin ||
    hasRole('admin') ||
    hasRole('manager') ||
    hasRole('operational_manager') ||
    hasRole('labour_productivity_approver') ||
    user?.user_id === 'HR01';
  const queryClient = useQueryClient();
  
  // Floor incharge cannot add/edit/delete employees
  const isFloorIncharge = user?.designation === "floor_incharge";
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<LabourEmployee | null>(null);
  const [employeeToDelete, setEmployeeToDelete] = useState<LabourEmployee | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("active");

  const [formData, setFormData] = useState({
    employee_code: "",
    full_name: "",
    department_id: "",
    contact_number: "",
    monthly_salary: 0,
    is_active: true,
    employee_type: "salary" as "salary" | "daily_wages",
    per_day_wages: 0,
    category: "",
    joining_date: "",
    attendance_allowance: 0,
    photo_url: "" as string,
  });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const dialogContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDialogOpen) return;

    requestAnimationFrame(() => {
      if (dialogContentRef.current) {
        dialogContentRef.current.scrollTop = 0;
      }
    });
  }, [isDialogOpen, editingEmployee]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
      setUploadingPhoto(true);
      const ext = file.name.split(".").pop() || "jpg";
      const codePart = (formData.employee_code || "emp").replace(/[^a-zA-Z0-9_-]/g, "");
      const path = `${codePart}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("labour-photos")
        .upload(path, file, { cacheControl: "3600", upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("labour-photos").getPublicUrl(path);
      setFormData((p) => ({ ...p, photo_url: data.publicUrl }));
      toast.success("Photo uploaded");
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

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

  const { data: labourCategories = [] } = useQuery({
    queryKey: ["labour-categories-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labour_categories")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["labour-employees-list", filterStatus],
    queryFn: async () => {
      let query = supabase
        .from("labour_employees")
        .select(`
          *,
          production_departments(id, name)
        `)
        .order("full_name");

      if (filterStatus === "active") {
        query = query.eq("is_active", true);
      } else if (filterStatus === "inactive") {
        query = query.eq("is_active", false);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as LabourEmployee[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = {
        employee_code: data.employee_code.trim(),
        full_name: data.full_name.trim(),
        department_id: data.department_id || null,
        contact_number: data.contact_number?.trim() || null,
        monthly_salary: data.employee_type === "salary" ? (data.monthly_salary || 0) : 0,
        is_active: data.is_active,
        employee_type: data.employee_type,
        per_day_wages: data.employee_type === "daily_wages" ? (data.per_day_wages || 0) : 0,
        category: data.category?.trim() || null,
        joining_date: data.joining_date || null,
        attendance_allowance: data.attendance_allowance || 0,
        photo_url: data.photo_url || null,
      };

      if (editingEmployee) {
        const { error } = await supabase
          .from("labour_employees")
          .update(payload)
          .eq("id", editingEmployee.id);
        if (error) throw error;
      } else {
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
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labour-employees-list"] });
      queryClient.invalidateQueries({ queryKey: ["labour-employees"] });
      toast.success(editingEmployee ? "Employee updated" : "Employee added");
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save employee");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Check if employee has productivity entries
      const { data: entries } = await supabase
        .from("labour_productivity_targets")
        .select("id")
        .eq("employee_id", id)
        .limit(1);
      
      if (entries && entries.length > 0) {
        throw new Error("Cannot delete employee with productivity entries. Deactivate instead.");
      }

      const { error } = await supabase
        .from("labour_employees")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labour-employees-list"] });
      queryClient.invalidateQueries({ queryKey: ["labour-employees"] });
      toast.success("Employee deleted");
      setDeleteDialogOpen(false);
      setEmployeeToDelete(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete employee");
    },
  });

  const resetForm = () => {
    setIsDialogOpen(false);
    setEditingEmployee(null);
    setFormData({
      employee_code: "",
      full_name: "",
      department_id: "",
      contact_number: "",
      monthly_salary: 0,
      is_active: true,
      employee_type: "salary",
      per_day_wages: 0,
      category: "",
      joining_date: "",
      attendance_allowance: 0,
      photo_url: "",
    });
  };

  const handleEdit = (employee: LabourEmployee) => {
    setEditingEmployee(employee);
    setFormData({
      employee_code: employee.employee_code,
      full_name: employee.full_name,
      department_id: employee.department_id || "",
      contact_number: employee.contact_number || "",
      monthly_salary: employee.monthly_salary || 0,
      is_active: employee.is_active,
      employee_type: employee.employee_type || "salary",
      per_day_wages: employee.per_day_wages || 0,
      category: employee.category || "",
      joining_date: employee.joining_date || "",
      attendance_allowance: employee.attendance_allowance || 0,
      photo_url: employee.photo_url || "",
    });
    setIsDialogOpen(true);
  };

  const handleDelete = (employee: LabourEmployee) => {
    setEmployeeToDelete(employee);
    setDeleteDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.employee_code || !formData.full_name) {
      toast.error("Please fill in required fields");
      return;
    }
    saveMutation.mutate(formData);
  };

  const filteredEmployees = employees.filter((emp) =>
    emp.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.employee_code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns: Column<LabourEmployee>[] = [
    {
      key: "photo",
      header: "",
      render: (item) => <EmployeeAvatar name={item.full_name} photoUrl={item.photo_url} />,
      className: "w-12",
    },
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
      key: "department",
      header: "Department",
      render: (item) => item.production_departments?.name || "-",
    },
    {
      key: "employee_type",
      header: "Type",
      render: (item) => (
        <Badge variant={item.employee_type === "salary" ? "default" : "outline"}>
          {item.employee_type === "salary" ? "Salary" : "Daily Wages"}
        </Badge>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (item) => item.category || "-",
    },
    {
      key: "wages",
      header: "Salary / Wages",
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
      key: "attendance_allowance",
      header: "Att. Allowance",
      render: (item) => (
        <span className="font-medium">Rs. {(item.attendance_allowance || 0).toLocaleString()}</span>
      ),
    },
    {
      key: "contact_number",
      header: "Contact",
      render: (item) => item.contact_number || "-",
    },
    {
      key: "joining_date",
      header: "Joining Date",
      className: "hidden md:table-cell",
      render: (item) => (
        <span className="text-sm">{item.joining_date ? format(new Date(item.joining_date), "dd MMM yyyy") : "-"}</span>
      ),
    },
    {
      key: "is_active",
      header: "Status",
      render: (item) => (
        <Badge variant={item.is_active ? "default" : "secondary"}>
          {item.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    ...(canEditCode ? [{
      key: "actions",
      header: "Actions",
      render: (item: LabourEmployee) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => handleEdit(item)} title="Edit">
            <Pencil className="h-4 w-4" />
          </Button>
          {isSuperAdmin && (
            <Button variant="ghost" size="icon" onClick={() => handleDelete(item)} title="Delete">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      ),
    }] : []),
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Labour Employee Center"
        description="Manage labour employees for productivity tracking"
        action={!isFloorIncharge ? {
          label: "Add Employee",
          onClick: () => setIsDialogOpen(true),
          icon: Plus,
        } : undefined}
      />

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
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable columns={columns} data={filteredEmployees} emptyMessage="No employees found" />

      {/* Add/Edit Employee Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent
          ref={dialogContentRef}
          className="top-3 max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1rem)] max-w-2xl translate-y-0 overflow-y-auto sm:top-[50%] sm:w-full sm:translate-y-[-50%]"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{editingEmployee ? "Edit Employee" : "Add Labour Employee"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Employee Code *</Label>
                <Input
                  value={formData.employee_code}
                  onChange={(e) => setFormData({ ...formData, employee_code: e.target.value })}
                  placeholder="e.g., LAB-001"
                  disabled={!!editingEmployee && !canEditCode}
                  required
                />
              </div>
              <div>
                <Label>Full Name *</Label>
                <Input
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  placeholder="Enter full name"
                  required
                />
              </div>
              <div className="sm:col-span-2 rounded-lg border border-dashed bg-muted/30 p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <EmployeeAvatar
                    name={formData.full_name}
                    photoUrl={formData.photo_url}
                    className="h-20 w-20 text-base"
                  />
                  <div className="flex-1 space-y-2">
                    <Label className="text-sm font-medium">Profile Photo</Label>
                    <div className="flex flex-wrap gap-2">
                      <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handlePhotoUpload}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => photoInputRef.current?.click()}
                        disabled={uploadingPhoto}
                      >
                        {uploadingPhoto ? (
                          <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Uploading...</>
                        ) : (
                          <><Upload className="mr-1.5 h-3.5 w-3.5" /> {formData.photo_url ? "Change" : "Upload"} Photo</>
                        )}
                      </Button>
                      {formData.photo_url && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setFormData({ ...formData, photo_url: "" })}
                        >
                          <X className="mr-1.5 h-3.5 w-3.5" /> Remove
                        </Button>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">JPG/PNG, max 2 MB</p>
                  </div>
                </div>
              </div>
              <div>
                <Label>Employee Type *</Label>
                <Select
                  value={formData.employee_type}
                  onValueChange={(value: "salary" | "daily_wages") => setFormData({ ...formData, employee_type: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="salary">Salary Based (with Sunday pay)</SelectItem>
                    <SelectItem value="daily_wages">Daily Wages (no Sunday pay)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formData.employee_type === "salary" ? (
                <div>
                  <Label>Monthly Salary (Rs.)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={formData.monthly_salary}
                    onChange={(e) => setFormData({ ...formData, monthly_salary: parseFloat(e.target.value) || 0 })}
                    placeholder="Enter monthly salary"
                  />
                </div>
              ) : (
                <div>
                  <Label>Per Day Wages (Rs.)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={formData.per_day_wages}
                    onChange={(e) => setFormData({ ...formData, per_day_wages: parseFloat(e.target.value) || 0 })}
                    placeholder="Enter per day wages"
                  />
                </div>
              )}
              <div>
                <Label>Department</Label>
                <Select value={formData.department_id} onValueChange={(value) => setFormData({ ...formData, department_id: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Contact Number</Label>
                <Input
                  value={formData.contact_number}
                  onChange={(e) => setFormData({ ...formData, contact_number: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div>
                <Label>Joining Date</Label>
                <Input
                  type="date"
                  value={formData.joining_date}
                  onChange={(e) => setFormData({ ...formData, joining_date: e.target.value })}
                />
              </div>
              <div>
                <Label>Category</Label>
                <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {labourCategories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.name}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Attendance Allowance (Rs.)</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.attendance_allowance}
                  onChange={(e) => setFormData({ ...formData, attendance_allowance: parseFloat(e.target.value) || 0 })}
                  placeholder="Enter attendance allowance"
                />
              </div>
              <div className="flex items-center gap-3 sm:col-span-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
                <Label>Active</Label>
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={resetForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Employee</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {employeeToDelete?.full_name}? 
              This action cannot be undone. If this employee has productivity entries, 
              consider deactivating them instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => employeeToDelete && deleteMutation.mutate(employeeToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
};

export default LabourEmployeesPage;
