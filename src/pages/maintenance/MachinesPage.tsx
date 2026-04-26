import { useState, useEffect } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, Pencil, Cog, ChevronLeft, ChevronRight } from "lucide-react";

interface Machine {
  id: string;
  code: string;
  name: string;
  machine_type: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  department_id: string | null;
  status: string | null;
  installation_date: string | null;
  notes: string | null;
  is_active: boolean;
  production_departments?: { name: string } | null;
}

interface Department {
  id: string;
  name: string;
  code: string;
}

const MACHINE_STATUSES = ["operational", "maintenance", "breakdown", "idle", "decommissioned"];

export default function MachinesPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 6;
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null);

  const [formData, setFormData] = useState({
    code: "",
    name: "",
    machine_type: "",
    manufacturer: "",
    model: "",
    serial_number: "",
    department_id: "",
    status: "operational",
    installation_date: "",
    notes: "",
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [machinesRes, deptRes] = await Promise.all([
        supabase.from("machines").select("*, production_departments(name)").order("name"),
        supabase.from("production_departments").select("id, name, code").eq("is_active", true).order("name"),
      ]);

      if (machinesRes.data) setMachines(machinesRes.data);
      if (deptRes.data) setDepartments(deptRes.data);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.code || !formData.name) {
      toast.error("Please fill in required fields (Code and Name)");
      return;
    }

    try {
      if (editingMachine) {
        const { error } = await supabase
          .from("machines")
          .update({
            code: formData.code,
            name: formData.name,
            machine_type: formData.machine_type || null,
            manufacturer: formData.manufacturer || null,
            model: formData.model || null,
            serial_number: formData.serial_number || null,
            department_id: formData.department_id || null,
            status: formData.status || "operational",
            installation_date: formData.installation_date || null,
            notes: formData.notes || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingMachine.id);

        if (error) throw error;
        toast.success("Machine updated successfully");
      } else {
        const { error } = await supabase.from("machines").insert({
          code: formData.code,
          name: formData.name,
          machine_type: formData.machine_type || null,
          manufacturer: formData.manufacturer || null,
          model: formData.model || null,
          serial_number: formData.serial_number || null,
          department_id: formData.department_id || null,
          status: formData.status || "operational",
          installation_date: formData.installation_date || null,
          notes: formData.notes || null,
        });

        if (error) throw error;
        toast.success("Machine added successfully");
      }

      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error("Error saving machine:", error);
      toast.error(error.message || "Failed to save machine");
    }
  };

  const resetForm = () => {
    setFormData({
      code: "",
      name: "",
      machine_type: "",
      manufacturer: "",
      model: "",
      serial_number: "",
      department_id: "",
      status: "operational",
      installation_date: "",
      notes: "",
    });
    setEditingMachine(null);
  };

  const openEditDialog = (machine: Machine) => {
    setEditingMachine(machine);
    setFormData({
      code: machine.code,
      name: machine.name,
      machine_type: machine.machine_type || "",
      manufacturer: machine.manufacturer || "",
      model: machine.model || "",
      serial_number: machine.serial_number || "",
      department_id: machine.department_id || "",
      status: machine.status || "operational",
      installation_date: machine.installation_date || "",
      notes: machine.notes || "",
    });
    setIsDialogOpen(true);
  };

  const filteredMachines = machines.filter(
    (m) =>
      m.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.machine_type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.production_departments?.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination logic
  const totalPages = Math.ceil(filteredMachines.length / ITEMS_PER_PAGE);
  const paginatedMachines = filteredMachines.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // Reset to page 1 when search changes
  const handleSearch = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const getStatusColor = (status: string | null) => {
    const colors: Record<string, string> = {
      operational: "bg-green-500",
      maintenance: "bg-amber-500",
      breakdown: "bg-red-500",
      idle: "bg-slate-500",
      decommissioned: "bg-gray-500",
    };
    return colors[status || "operational"] || "bg-slate-500";
  };

  const columns = [
    { key: "code", header: "Code" },
    { key: "name", header: "Name" },
    { key: "machine_type", header: "Type", render: (row: Machine) => row.machine_type || "-" },
    { key: "department_id", header: "Department", render: (row: Machine) => row.production_departments?.name || "-" },
    { key: "manufacturer", header: "Manufacturer", render: (row: Machine) => row.manufacturer || "-" },
    { key: "model", header: "Model", render: (row: Machine) => row.model || "-" },
    {
      key: "status",
      header: "Status",
      render: (row: Machine) => (
        <Badge className={`${getStatusColor(row.status)} text-white`}>
          {(row.status || "operational").toUpperCase()}
        </Badge>
      ),
    },
    {
      key: "is_active",
      header: "Active",
      render: (row: Machine) => (
        <Badge variant={row.is_active ? "default" : "secondary"}>
          {row.is_active ? "Yes" : "No"}
        </Badge>
      ),
    },
    {
      key: "id",
      header: "Actions",
      render: (row: Machine) => (
        <Button variant="ghost" size="sm" onClick={() => openEditDialog(row)}>
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Machines / Assets"
        description="Manage machines and equipment for maintenance"
        action={{
          label: "Add Machine",
          onClick: () => { resetForm(); setIsDialogOpen(true); },
        }}
      />

      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search machines..."
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : (
        <>
          <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-muted-foreground/30 scrollbar-track-transparent">
            <DataTable columns={columns} data={paginatedMachines} />
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-muted-foreground">
                Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} - {Math.min(currentPage * ITEMS_PER_PAGE, filteredMachines.length)} of {filteredMachines.length}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm px-2">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cog className="h-5 w-5 text-primary" />
              {editingMachine ? "Edit Machine" : "Add New Machine"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Code *</Label>
                <Input
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="e.g., MCH-001"
                />
              </div>
              <div>
                <Label>Machine Type</Label>
                <Input
                  value={formData.machine_type}
                  onChange={(e) => setFormData({ ...formData, machine_type: e.target.value })}
                  placeholder="e.g., Press, Cutter"
                />
              </div>
            </div>

            <div>
              <Label>Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter machine name"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Manufacturer</Label>
                <Input
                  value={formData.manufacturer}
                  onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                  placeholder="e.g., Siemens"
                />
              </div>
              <div>
                <Label>Model</Label>
                <Input
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  placeholder="e.g., XR-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Serial Number</Label>
                <Input
                  value={formData.serial_number}
                  onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                  placeholder="Serial number"
                />
              </div>
              <div>
                <Label>Department</Label>
                <Select value={formData.department_id} onValueChange={(v) => setFormData({ ...formData, department_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MACHINE_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Installation Date</Label>
                <Input
                  type="date"
                  value={formData.installation_date}
                  onChange={(e) => setFormData({ ...formData, installation_date: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Any additional notes"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>{editingMachine ? "Update" : "Add Machine"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
