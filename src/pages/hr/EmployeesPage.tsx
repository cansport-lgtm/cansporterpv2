import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Pencil, Trash2 } from "lucide-react";
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
import { format } from "date-fns";

interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

interface Employee {
  id: string;
  employee_code: string;
  full_name: string;
  department_id: string | null;
  designation_id: string | null;
  contact_number: string | null;
  address: string | null;
  emergency_contact: string | null;
  joining_date: string | null;
  status: string | null;
  is_active: boolean;
  basic_salary: number | null;
  allowances: number | null;
  production_departments?: { id: string; name: string } | null;
  designations?: { id: string; name: string } | null;
}

const EmployeesPage = () => {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("active");

  const [formData, setFormData] = useState({
    employee_code: "",
    full_name: "",
    department_id: "",
    designation_id: "",
    contact_number: "",
    address: "",
    emergency_contact: "",
    joining_date: "",
    status: "active",
    is_active: true,
    basic_salary: "",
    allowances: "",
    attendance_allowance: "",
    duty_start_time: "09:00",
    duty_end_time: "18:00",
    duty_hours: "8",
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

  const { data: designations = [] } = useQuery({
    queryKey: ["designations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("designations")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["hr-employees-list", filterStatus],
    queryFn: async () => {
      let query = supabase
        .from("employees")
        .select(`
          *,
          production_departments(id, name),
          designations(id, name)
        `)
        .order("full_name");

      if (filterStatus === "active") {
        query = query.eq("is_active", true);
      } else if (filterStatus === "inactive") {
        query = query.eq("is_active", false);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Employee[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = {
        employee_code: data.employee_code.trim(),
        full_name: data.full_name.trim(),
        department_id: data.department_id || null,
        designation_id: data.designation_id || null,
        contact_number: data.contact_number?.trim() || null,
        address: data.address?.trim() || null,
        emergency_contact: data.emergency_contact?.trim() || null,
        joining_date: data.joining_date || null,
        status: data.status || "active",
        is_active: data.is_active,
        basic_salary: data.basic_salary ? parseFloat(data.basic_salary) : 0,
        allowances: data.allowances ? parseFloat(data.allowances) : 0,
        attendance_allowance: data.attendance_allowance ? parseFloat(data.attendance_allowance) : 0,
        duty_start_time: data.duty_start_time || "09:00",
        duty_end_time: data.duty_end_time || "18:00",
        duty_hours: data.duty_hours ? parseFloat(data.duty_hours) : 8,
      };

      if (editingEmployee) {
        const { error } = await supabase
          .from("employees")
          .update(payload)
          .eq("id", editingEmployee.id);
        if (error) throw error;
      } else {
        // Check for duplicate employee code
        const { data: existing } = await supabase
          .from("employees")
          .select("id")
          .eq("employee_code", data.employee_code.trim())
          .maybeSingle();
        
        if (existing) {
          throw new Error("Employee code already exists. Please use a unique code.");
        }

        const { error } = await supabase
          .from("employees")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-employees-list"] });
      queryClient.invalidateQueries({ queryKey: ["employees-active"] });
      toast.success(editingEmployee ? "Employee updated" : "Employee added");
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save employee");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Check if employee has attendance or leave records
      const { data: attendance } = await supabase
        .from("attendance")
        .select("id")
        .eq("employee_id", id)
        .limit(1);
      
      if (attendance && attendance.length > 0) {
        throw new Error("Cannot delete employee with attendance records. Deactivate instead.");
      }

      const { data: leaves } = await supabase
        .from("leave_requests")
        .select("id")
        .eq("employee_id", id)
        .limit(1);
      
      if (leaves && leaves.length > 0) {
        throw new Error("Cannot delete employee with leave requests. Deactivate instead.");
      }

      const { error } = await supabase
        .from("employees")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-employees-list"] });
      queryClient.invalidateQueries({ queryKey: ["employees-active"] });
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
      designation_id: "",
      contact_number: "",
      address: "",
      emergency_contact: "",
      joining_date: "",
      status: "active",
      is_active: true,
      basic_salary: "",
      allowances: "",
      attendance_allowance: "",
      duty_start_time: "09:00",
      duty_end_time: "18:00",
      duty_hours: "8",
    });
  };

  const handleEdit = (employee: Employee) => {
    setEditingEmployee(employee);
    setFormData({
      employee_code: employee.employee_code,
      full_name: employee.full_name,
      department_id: employee.department_id || "",
      designation_id: employee.designation_id || "",
      contact_number: employee.contact_number || "",
      address: employee.address || "",
      emergency_contact: employee.emergency_contact || "",
      joining_date: employee.joining_date || "",
      status: employee.status || "active",
      is_active: employee.is_active,
      basic_salary: employee.basic_salary?.toString() || "",
      allowances: employee.allowances?.toString() || "",
      attendance_allowance: (employee as any).attendance_allowance?.toString() || "",
      duty_start_time: (employee as any).duty_start_time || "09:00",
      duty_end_time: (employee as any).duty_end_time || "18:00",
      duty_hours: (employee as any).duty_hours?.toString() || "8",
    });
    setIsDialogOpen(true);
  };

  const handleDelete = (employee: Employee) => {
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

  const columns: Column<Employee>[] = [
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
      key: "designation",
      header: "Designation",
      render: (item) => item.designations?.name || "-",
    },
    {
      key: "contact_number",
      header: "Contact",
      render: (item) => item.contact_number || "-",
    },
    {
      key: "joining_date",
      header: "Joining Date",
      render: (item) => item.joining_date ? format(new Date(item.joining_date), "dd MMM yyyy") : "-",
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
    {
      key: "actions",
      header: "Actions",
      render: (item) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => handleEdit(item)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleDelete(item)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Employee Management"
        description="Manage employees for HR operations"
        action={{
          label: "Add Employee",
          onClick: () => setIsDialogOpen(true),
          icon: Plus,
        }}
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingEmployee ? "Edit Employee" : "Add Employee"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Employee Code *</Label>
                  <Input
                    value={formData.employee_code}
                    onChange={(e) => setFormData({ ...formData, employee_code: e.target.value })}
                    placeholder="e.g., EMP-001"
                    disabled={!!editingEmployee}
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
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Department</Label>
                  <Select
                    value={formData.department_id}
                    onValueChange={(val) => setFormData({ ...formData, department_id: val })}
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
                  <Label>Designation</Label>
                  <Select
                    value={formData.designation_id}
                    onValueChange={(val) => setFormData({ ...formData, designation_id: val })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select designation" />
                    </SelectTrigger>
                    <SelectContent>
                      {designations.map((desig) => (
                        <SelectItem key={desig.id} value={desig.id}>
                          {desig.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Contact Number</Label>
                  <Input
                    value={formData.contact_number}
                    onChange={(e) => setFormData({ ...formData, contact_number: e.target.value })}
                    placeholder="Phone number"
                  />
                </div>
                <div>
                  <Label>Emergency Contact</Label>
                  <Input
                    value={formData.emergency_contact}
                    onChange={(e) => setFormData({ ...formData, emergency_contact: e.target.value })}
                    placeholder="Emergency contact"
                  />
                </div>
              </div>

              <div>
                <Label>Address</Label>
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Address"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Joining Date</Label>
                  <Input
                    type="date"
                    value={formData.joining_date}
                    onChange={(e) => setFormData({ ...formData, joining_date: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(val) => setFormData({ ...formData, status: val })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="probation">Probation</SelectItem>
                      <SelectItem value="resigned">Resigned</SelectItem>
                      <SelectItem value="terminated">Terminated</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Basic Salary (Rs.)</Label>
                  <Input
                    type="number"
                    value={formData.basic_salary}
                    onChange={(e) => setFormData({ ...formData, basic_salary: e.target.value })}
                    placeholder="0"
                    min="0"
                  />
                </div>
                <div>
                  <Label>Allowances (Rs.)</Label>
                  <Input
                    type="number"
                    value={formData.allowances}
                    onChange={(e) => setFormData({ ...formData, allowances: e.target.value })}
                    placeholder="0"
                    min="0"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Attendance Allowance (Rs.)</Label>
                  <Input
                    type="number"
                    value={formData.attendance_allowance}
                    onChange={(e) => setFormData({ ...formData, attendance_allowance: e.target.value })}
                    placeholder="0"
                    min="0"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Auto-added if 100% present all working days</p>
                </div>
              </div>

              {/* Duty Hours Section */}
              <div className="border-t pt-4">
                <Label className="text-sm font-semibold text-muted-foreground">Official Duty Hours</Label>
                <div className="grid grid-cols-3 gap-3 mt-2">
                  <div>
                    <Label className="text-xs">Start Time</Label>
                    <Input
                      type="time"
                      value={formData.duty_start_time}
                      onChange={(e) => setFormData({ ...formData, duty_start_time: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">End Time</Label>
                    <Input
                      type="time"
                      value={formData.duty_end_time}
                      onChange={(e) => setFormData({ ...formData, duty_end_time: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Hours/Day</Label>
                    <Input
                      type="number"
                      value={formData.duty_hours}
                      onChange={(e) => setFormData({ ...formData, duty_hours: e.target.value })}
                      placeholder="8"
                      min="1"
                      max="24"
                      step="0.5"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
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
              This action cannot be undone. If this employee has attendance or leave records, 
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

export default EmployeesPage;