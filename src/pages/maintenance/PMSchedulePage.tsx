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
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, Search, Pencil, Calendar, AlertCircle, CalendarIcon } from "lucide-react";
import { format, addDays, isBefore, isToday, isYesterday, isSameDay, isSameMonth } from "date-fns";
import { cn } from "@/lib/utils";

interface MaintenanceSchedule {
  id: string;
  schedule_number: string;
  machine_id: string | null;
  maintenance_type_id: string | null;
  technician_name: string | null;
  title: string;
  description: string | null;
  frequency_days: number;
  last_performed_date: string | null;
  next_due_date: string;
  priority: string;
  estimated_duration_hours: number | null;
  instructions: string | null;
  is_active: boolean;
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

export default function PMSchedulePage() {
  const { user } = useAuth();
  const [schedules, setSchedules] = useState<MaintenanceSchedule[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [maintenanceTypes, setMaintenanceTypes] = useState<MaintenanceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "in_progress" | "completed">("all");
  const [completedFilter, setCompletedFilter] = useState<"all" | "today" | "yesterday" | "date" | "month">("all");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedMonth, setSelectedMonth] = useState<Date | undefined>(undefined);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<MaintenanceSchedule | null>(null);

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    machine_id: "",
    maintenance_type_id: "",
    technician_name: "",
    frequency_days: 30,
    next_due_date: "",
    priority: "medium",
    estimated_duration_hours: "",
    instructions: "",
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [schedulesRes, machinesRes, typesRes] = await Promise.all([
        supabase.from("maintenance_schedules").select("*, machines(name, code), maintenance_types(name)").eq("is_active", true).order("next_due_date"),
        supabase.from("machines").select("id, name, code").eq("is_active", true).order("name"),
        supabase.from("maintenance_types").select("*").eq("is_active", true).order("name"),
      ]);

      if (schedulesRes.data) setSchedules(schedulesRes.data);
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
    if (!formData.title || !formData.frequency_days || !formData.next_due_date) {
      toast.error("Please fill in required fields");
      return;
    }

    try {
      if (editingSchedule) {
        const { error } = await supabase
          .from("maintenance_schedules")
          .update({
            title: formData.title,
            description: formData.description || null,
            machine_id: formData.machine_id || null,
            maintenance_type_id: formData.maintenance_type_id || null,
            technician_name: formData.technician_name || null,
            frequency_days: formData.frequency_days,
            next_due_date: formData.next_due_date,
            priority: formData.priority as "low" | "medium" | "high" | "critical",
            estimated_duration_hours: formData.estimated_duration_hours ? parseFloat(formData.estimated_duration_hours) : null,
            instructions: formData.instructions || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingSchedule.id);

        if (error) throw error;
        toast.success("Schedule updated");
      } else {
        const { data: numData } = await supabase.rpc("generate_schedule_number");

        const { error } = await supabase.from("maintenance_schedules").insert({
          schedule_number: numData || `SCH-${Date.now()}`,
          title: formData.title,
          description: formData.description || null,
          machine_id: formData.machine_id || null,
          maintenance_type_id: formData.maintenance_type_id || null,
          technician_name: formData.technician_name || null,
          frequency_days: formData.frequency_days,
          next_due_date: formData.next_due_date,
          priority: formData.priority as "low" | "medium" | "high" | "critical",
          estimated_duration_hours: formData.estimated_duration_hours ? parseFloat(formData.estimated_duration_hours) : null,
          instructions: formData.instructions || null,
          created_by: user?.id,
        });

        if (error) throw error;
        toast.success("Schedule created");
      }

      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error("Error saving schedule:", error);
      toast.error(error.message || "Failed to save schedule");
    }
  };

  const resetForm = () => {
    setFormData({
      title: "",
      description: "",
      machine_id: "",
      maintenance_type_id: "",
      technician_name: "",
      frequency_days: 30,
      next_due_date: "",
      priority: "medium",
      estimated_duration_hours: "",
      instructions: "",
    });
    setEditingSchedule(null);
  };

  const openEditDialog = (schedule: MaintenanceSchedule) => {
    setEditingSchedule(schedule);
    setFormData({
      title: schedule.title,
      description: schedule.description || "",
      machine_id: schedule.machine_id || "",
      maintenance_type_id: schedule.maintenance_type_id || "",
      technician_name: schedule.technician_name || "",
      frequency_days: schedule.frequency_days,
      next_due_date: schedule.next_due_date,
      priority: schedule.priority,
      estimated_duration_hours: schedule.estimated_duration_hours?.toString() || "",
      instructions: schedule.instructions || "",
    });
    setIsDialogOpen(true);
  };

  const markAsCompleted = async (schedule: MaintenanceSchedule) => {
    try {
      const today = new Date();
      const newDueDate = addDays(today, schedule.frequency_days);

      const { error } = await supabase
        .from("maintenance_schedules")
        .update({
          last_performed_date: format(today, "yyyy-MM-dd"),
          next_due_date: format(newDueDate, "yyyy-MM-dd"),
          updated_at: new Date().toISOString(),
        })
        .eq("id", schedule.id);

      if (error) throw error;
      toast.success("Marked as completed, next due date updated");
      fetchData();
    } catch (error: any) {
      console.error("Error updating schedule:", error);
      toast.error(error.message || "Failed to update schedule");
    }
  };

  const filteredSchedules = schedules.filter((s) => {
    const matchesSearch =
      s.schedule_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.machines?.name.toLowerCase().includes(searchTerm.toLowerCase());

    // Status filter
    let matchesStatus = true;
    if (statusFilter === "completed") {
      matchesStatus = s.last_performed_date !== null;
    } else if (statusFilter === "in_progress") {
      matchesStatus = s.last_performed_date === null;
    }

    // Completed date filter (only applies when status is "completed")
    let matchesCompletedDate = true;
    if (statusFilter === "completed" && s.last_performed_date) {
      const performedDate = new Date(s.last_performed_date);
      
      if (completedFilter === "today") {
        matchesCompletedDate = isToday(performedDate);
      } else if (completedFilter === "yesterday") {
        matchesCompletedDate = isYesterday(performedDate);
      } else if (completedFilter === "date" && selectedDate) {
        matchesCompletedDate = isSameDay(performedDate, selectedDate);
      } else if (completedFilter === "month" && selectedMonth) {
        matchesCompletedDate = isSameMonth(performedDate, selectedMonth);
      }
    }

    return matchesSearch && matchesStatus && matchesCompletedDate;
  });

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      low: "bg-slate-500",
      medium: "bg-blue-500",
      high: "bg-amber-500",
      critical: "bg-red-500",
    };
    return colors[priority] || "bg-slate-500";
  };

  const getDueStatus = (dueDate: string) => {
    const today = new Date();
    const due = new Date(dueDate);
    if (isBefore(due, today)) return { label: "Overdue", color: "bg-red-500" };
    const daysUntil = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil <= 7) return { label: "Due Soon", color: "bg-amber-500" };
    return { label: "Scheduled", color: "bg-green-500" };
  };

  const columns = [
    { key: "schedule_number", header: "Schedule #" },
    { key: "title", header: "Title" },
    { key: "machine_id", header: "Machine", render: (row: MaintenanceSchedule) => row.machines?.name || "-" },
    { key: "maintenance_type_id", header: "Type", render: (row: MaintenanceSchedule) => row.maintenance_types?.name || "-" },
    { key: "technician_name", header: "Technician", render: (row: MaintenanceSchedule) => row.technician_name || "-" },
    { key: "frequency_days", header: "Frequency", render: (row: MaintenanceSchedule) => `${row.frequency_days} days` },
    { key: "next_due_date", header: "Next Due", render: (row: MaintenanceSchedule) => {
        const status = getDueStatus(row.next_due_date);
        return (
          <div className="flex items-center gap-2">
            <span>{format(new Date(row.next_due_date), "dd-MMM-yyyy")}</span>
            <Badge className={`${status.color} text-white`}>{status.label}</Badge>
          </div>
        );
      },
    },
    { key: "priority", header: "Priority", render: (row: MaintenanceSchedule) => (
        <span className={`px-2 py-1 rounded text-xs text-white ${getPriorityColor(row.priority)}`}>
          {row.priority.toUpperCase()}
        </span>
      ),
    },
    { key: "id", header: "Actions", render: (row: MaintenanceSchedule) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => openEditDialog(row)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => markAsCompleted(row)}>
            Complete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="PM Schedule"
        description="Manage preventive maintenance schedules"
        action={{
          label: "New Schedule",
          onClick: () => { resetForm(); setIsDialogOpen(true); },
        }}
      />

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search schedules..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v: "all" | "in_progress" | "completed") => {
          setStatusFilter(v);
          if (v !== "completed") {
            setCompletedFilter("all");
            setSelectedDate(undefined);
            setSelectedMonth(undefined);
          }
        }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Schedules</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>

        {statusFilter === "completed" && (
          <>
            <Select value={completedFilter} onValueChange={(v: "all" | "today" | "yesterday" | "date" | "month") => {
              setCompletedFilter(v);
              if (v !== "date") setSelectedDate(undefined);
              if (v !== "month") setSelectedMonth(undefined);
            }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Completed when" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="date">Select Date</SelectItem>
                <SelectItem value="month">Select Month</SelectItem>
              </SelectContent>
            </Select>

            {completedFilter === "date" && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[180px] justify-start text-left font-normal",
                      !selectedDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {selectedDate ? format(selectedDate, "dd-MMM-yyyy") : "Pick date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            )}

            {completedFilter === "month" && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[180px] justify-start text-left font-normal",
                      !selectedMonth && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {selectedMonth ? format(selectedMonth, "MMMM yyyy") : "Pick month"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={selectedMonth}
                    onSelect={setSelectedMonth}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            )}
          </>
        )}
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : (
        <DataTable columns={columns} data={filteredSchedules} />
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              {editingSchedule ? "Edit PM Schedule" : "New PM Schedule"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Title *</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Enter schedule title"
              />
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe the maintenance task"
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
                <Label>Maintenance Type</Label>
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

            <div>
              <Label>Technician</Label>
              <Input
                value={formData.technician_name}
                onChange={(e) => setFormData({ ...formData, technician_name: e.target.value })}
                placeholder="Enter technician name"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Frequency (days) *</Label>
                <Input
                  type="number"
                  value={formData.frequency_days}
                  onChange={(e) => setFormData({ ...formData, frequency_days: parseInt(e.target.value) || 30 })}
                  min={1}
                />
              </div>

              <div>
                <Label>Next Due Date *</Label>
                <Input
                  type="date"
                  value={formData.next_due_date}
                  onChange={(e) => setFormData({ ...formData, next_due_date: e.target.value })}
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

              <div>
                <Label>Est. Duration (hours)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={formData.estimated_duration_hours}
                  onChange={(e) => setFormData({ ...formData, estimated_duration_hours: e.target.value })}
                  placeholder="e.g., 2.5"
                />
              </div>
            </div>

            <div>
              <Label>Instructions</Label>
              <Textarea
                value={formData.instructions}
                onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
                placeholder="Maintenance instructions or checklist"
                rows={4}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>{editingSchedule ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
