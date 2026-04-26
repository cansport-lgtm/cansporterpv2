import { useState, useEffect } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, Search, Pencil, Eye, MoreHorizontal, RefreshCw } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format } from "date-fns";

interface WorkOrder {
  id: string;
  work_order_number: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  requested_date: string;
  scheduled_date: string | null;
  machine_id: string | null;
  maintenance_type_id: string | null;
  technician_name: string | null;
  machines?: { name: string; code: string } | null;
  maintenance_types?: { name: string } | null;
}

interface Machine {
  id: string;
  name: string;
  code: string;
}

interface MaintenanceType {
  id: string;
  name: string;
  code: string;
}

export default function WorkOrdersPage() {
  const { user } = useAuth();
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [maintenanceTypes, setMaintenanceTypes] = useState<MaintenanceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<WorkOrder | null>(null);
  const [newStatus, setNewStatus] = useState("");
  const [editingOrder, setEditingOrder] = useState<WorkOrder | null>(null);

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    machine_id: "",
    maintenance_type_id: "",
    technician_name: "",
    priority: "medium",
    scheduled_date: "",
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ordersRes, machinesRes, typesRes] = await Promise.all([
        supabase.from("maintenance_work_orders").select("*, machines(name, code), maintenance_types(name)").order("created_at", { ascending: false }),
        supabase.from("machines").select("id, name, code").eq("is_active", true).order("name"),
        supabase.from("maintenance_types").select("*").eq("is_active", true).order("name"),
      ]);

      if (ordersRes.data) setWorkOrders(ordersRes.data);
      if (machinesRes.data) setMachines(machinesRes.data);
      if (typesRes.data) setMaintenanceTypes(typesRes.data);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.title) {
      toast.error("Please enter a title");
      return;
    }

    try {
      if (editingOrder) {
        const { error } = await supabase
          .from("maintenance_work_orders")
          .update({
            title: formData.title,
            description: formData.description || null,
            machine_id: formData.machine_id || null,
            maintenance_type_id: formData.maintenance_type_id || null,
            technician_name: formData.technician_name || null,
            priority: formData.priority as "low" | "medium" | "high" | "critical",
            scheduled_date: formData.scheduled_date || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingOrder.id);

        if (error) throw error;
        toast.success("Work order updated");
      } else {
        // Generate work order number
        const { data: numData } = await supabase.rpc("generate_work_order_number");
        
        const { error } = await supabase.from("maintenance_work_orders").insert({
          work_order_number: numData || `WO-${Date.now()}`,
          title: formData.title,
          description: formData.description || null,
          machine_id: formData.machine_id || null,
          maintenance_type_id: formData.maintenance_type_id || null,
          technician_name: formData.technician_name || null,
          priority: formData.priority as "low" | "medium" | "high" | "critical",
          scheduled_date: formData.scheduled_date || null,
          requested_by: user?.id,
        });

        if (error) throw error;
        toast.success("Work order created");
      }

      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error("Error saving work order:", error);
      toast.error(error.message || "Failed to save work order");
    }
  };

  const resetForm = () => {
    setFormData({
      title: "",
      description: "",
      machine_id: "",
      maintenance_type_id: "",
      technician_name: "",
      priority: "medium",
      scheduled_date: "",
    });
    setEditingOrder(null);
  };

  const openEditDialog = (order: WorkOrder) => {
    setEditingOrder(order);
    setFormData({
      title: order.title,
      description: order.description || "",
      machine_id: order.machine_id || "",
      maintenance_type_id: order.maintenance_type_id || "",
      technician_name: order.technician_name || "",
      priority: order.priority,
      scheduled_date: order.scheduled_date || "",
    });
    setIsDialogOpen(true);
  };

  const openStatusDialog = (order: WorkOrder) => {
    setSelectedOrder(order);
    setNewStatus(order.status);
    setIsStatusDialogOpen(true);
  };

  const handleStatusUpdate = async () => {
    if (!selectedOrder || !newStatus) return;

    try {
      const updateData: Record<string, any> = {
        status: newStatus,
        updated_at: new Date().toISOString(),
      };

      // Set timestamps based on status
      if (newStatus === "in_progress" && selectedOrder.status === "draft") {
        updateData.started_at = new Date().toISOString();
      }
      if (newStatus === "closed") {
        updateData.completed_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from("maintenance_work_orders")
        .update(updateData)
        .eq("id", selectedOrder.id);

      if (error) throw error;

      toast.success(`Status updated to ${formatStatus(newStatus)}`);
      setIsStatusDialogOpen(false);
      setSelectedOrder(null);
      fetchData();
    } catch (error: any) {
      console.error("Error updating status:", error);
      toast.error(error.message || "Failed to update status");
    }
  };

  const formatStatus = (status: string) => {
    return status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const filteredOrders = workOrders.filter((o) => {
    const matchesSearch =
      o.work_order_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.machines?.name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || o.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusOptions = [
    { value: "all", label: "All Statuses" },
    { value: "draft", label: "Draft" },
    { value: "in_progress", label: "In Progress" },
    { value: "pending_approval", label: "Pending Approval" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "closed", label: "Closed" },
  ];

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      low: "bg-slate-500",
      medium: "bg-blue-500",
      high: "bg-amber-500",
      critical: "bg-red-500",
    };
    return colors[priority] || "bg-slate-500";
  };

  const columns = [
    { key: "work_order_number", header: "WO Number" },
    { key: "title", header: "Title" },
    { key: "machine_id", header: "Machine", render: (row: WorkOrder) => row.machines?.name || "-" },
    { key: "maintenance_type_id", header: "Type", render: (row: WorkOrder) => row.maintenance_types?.name || "-" },
    { key: "technician_name", header: "Technician", render: (row: WorkOrder) => row.technician_name || "-" },
    { key: "priority", header: "Priority", render: (row: WorkOrder) => (
        <span className={`px-2 py-1 rounded text-xs text-white ${getPriorityColor(row.priority)}`}>
          {row.priority.toUpperCase()}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (row: WorkOrder) => <StatusBadge status={row.status} /> },
    { key: "requested_date", header: "Requested", render: (row: WorkOrder) => format(new Date(row.requested_date), "dd-MMM-yyyy") },
    { key: "id", header: "Actions", render: (row: WorkOrder) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => openEditDialog(row)}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openStatusDialog(row)}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Update Status
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Work Orders"
        description="Manage maintenance work orders"
        action={{
          label: "New Work Order",
          onClick: () => { resetForm(); setIsDialogOpen(true); },
        }}
      />

      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search work orders..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : (
        <DataTable columns={columns} data={filteredOrders} />
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingOrder ? "Edit Work Order" : "New Work Order"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Title *</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Enter work order title"
              />
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe the work to be done"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Machine</Label>
                <Select value={formData.machine_id} onValueChange={(v) => setFormData({ ...formData, machine_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select machine" />
                  </SelectTrigger>
                  <SelectContent>
                    {machines.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} ({m.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Type</Label>
                <Select value={formData.maintenance_type_id} onValueChange={(v) => setFormData({ ...formData, maintenance_type_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {maintenanceTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Technician</Label>
                <Input
                  value={formData.technician_name}
                  onChange={(e) => setFormData({ ...formData, technician_name: e.target.value })}
                  placeholder="Enter technician name"
                />
              </div>

              <div>
                <Label>Scheduled Date</Label>
                <Input
                  type="date"
                  value={formData.scheduled_date}
                  onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Priority</Label>
                <Select value={formData.priority} onValueChange={(v) => setFormData({ ...formData, priority: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>{editingOrder ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status Update Dialog */}
      <Dialog open={isStatusDialogOpen} onOpenChange={setIsStatusDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Update Status</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2">
                Work Order: <span className="font-medium text-foreground">{selectedOrder?.work_order_number}</span>
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                Current: <StatusBadge status={selectedOrder?.status || ""} />
              </p>
            </div>
            <div>
              <Label>New Status</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="pending_approval">Pending Approval</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsStatusDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleStatusUpdate}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
