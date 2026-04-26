import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, addDays, addWeeks, subWeeks } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Plus,
  Save,
  Trash2,
  Factory,
  
  ChevronsUpDown,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PlanItem {
  id?: string;
  department_id: string;
  machine_id?: string;
  grade_id: string;
  planning_item_id?: string;
  planned_date: string;
  planned_qty_dozens: number;
  capacity_required_hrs: number;
  priority: string;
  remarks: string;
}

export default function WeeklyPlanningPage() {
  const queryClient = useQueryClient();
  const [selectedWeek, setSelectedWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>(() => {
    const saved = localStorage.getItem("planning-selected-departments");
    return saved ? JSON.parse(saved) : [];
  });

  // Persist selected departments to localStorage
  useEffect(() => {
    localStorage.setItem("planning-selected-departments", JSON.stringify(selectedDepartments));
  }, [selectedDepartments]);

  const weekStart = startOfWeek(selectedWeek, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(selectedWeek, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 6 }, (_, i) => addDays(weekStart, i)); // Mon-Sat

  // Form state for adding items
  const [newItem, setNewItem] = useState({
    department_id: "",
    machine_id: "",
    grade_id: "",
    planning_item_id: "",
    planned_qty_dozens: 0,
    capacity_required_hrs: 0,
    priority: "medium",
    remarks: "",
  });
  const [selectedDates, setSelectedDates] = useState<string[]>([]);

  // Fetch departments ordered by sequence
  const { data: departments } = useQuery({
    queryKey: ["departments-planning"],
    queryFn: async () => {
      const { data } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true)
        .order("sequence_order");
      return data || [];
    },
  });

  // Fetch machines with department filter
  const { data: machines } = useQuery({
    queryKey: ["machines-planning"],
    queryFn: async () => {
      const { data } = await supabase
        .from("machines")
        .select("*, production_departments(name)")
        .eq("is_active", true)
        .order("code");
      return data || [];
    },
  });

  const { data: grades } = useQuery({
    queryKey: ["grades"],
    queryFn: async () => {
      const { data } = await supabase
        .from("grades")
        .select("*")
        .eq("is_active", true)
        .order("code");
      return data || [];
    },
  });

  // Fetch planning items (department-wise items)
  const { data: planningItems } = useQuery({
    queryKey: ["planning-items-for-form"],
    queryFn: async () => {
      const { data } = await supabase
        .from("planning_items")
        .select("*")
        .eq("is_active", true)
        .order("code");
      return data || [];
    },
  });

  // Fetch capacity master for machine-based capacity
  const { data: capacityMaster } = useQuery({
    queryKey: ["capacity-master-planning"],
    queryFn: async () => {
      const { data } = await supabase
        .from("capacity_master")
        .select("*, machines(name, code), production_departments(name)")
        .eq("is_active", true);
      return data || [];
    },
  });

  // Fetch existing plan items for the week
  const { data: existingItems } = useQuery({
    queryKey: ["planning-items", format(weekStart, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data } = await supabase
        .from("production_planning_items")
        .select(`
          *,
          grades (code, name),
          planning_items (code, name, unit)
        `)
        .gte("planned_date", format(weekStart, "yyyy-MM-dd"))
        .lte("planned_date", format(weekEnd, "yyyy-MM-dd"))
        .order("planned_date");
      return data || [];
    },
  });

  // Filter machines by selected department in form
  const filteredMachines = useMemo(() => {
    if (!newItem.department_id) return machines || [];
    return machines?.filter((m: any) => m.department_id === newItem.department_id) || [];
  }, [machines, newItem.department_id]);

  // Filter planning items by selected department
  const filteredPlanningItems = useMemo(() => {
    if (!newItem.department_id) return planningItems || [];
    return planningItems?.filter((p: any) => p.department_id === newItem.department_id) || [];
  }, [planningItems, newItem.department_id]);

  // Get capacity for selected machine
  const getCapacityPerHour = (machineId: string) => {
    const cap = capacityMaster?.find((c: any) => c.machine_id === machineId);
    return cap?.capacity_per_hour || 0;
  };

  // Calculate required hours based on quantity and machine capacity
  const calculateRequiredHours = (qty: number, machineId: string) => {
    const capacityPerHour = getCapacityPerHour(machineId);
    if (capacityPerHour <= 0) return 0;
    return Number((qty / capacityPerHour).toFixed(2));
  };

  // Group items by department and day
  const itemsByDeptAndDay = useMemo(() => {
    const grouped: Record<string, Record<string, any[]>> = {};
    departments?.forEach((dept: any) => {
      grouped[dept.id] = {};
      weekDays.forEach((day) => {
        grouped[dept.id][format(day, "yyyy-MM-dd")] = [];
      });
    });
    existingItems?.forEach((item: any) => {
      const deptId = item.department_id;
      const dateKey = item.planned_date;
      if (deptId && grouped[deptId]?.[dateKey]) {
        grouped[deptId][dateKey].push(item);
      }
    });
    return grouped;
  }, [existingItems, departments, weekDays]);

  // Calculate department totals
  const departmentTotals = useMemo(() => {
    const totals: Record<string, { qty: number; hrs: number }> = {};
    departments?.forEach((dept: any) => {
      totals[dept.id] = { qty: 0, hrs: 0 };
    });
    existingItems?.forEach((item: any) => {
      if (item.department_id && totals[item.department_id]) {
        totals[item.department_id].qty += Number(item.planned_qty_dozens) || 0;
        totals[item.department_id].hrs += Number(item.capacity_required_hrs) || 0;
      }
    });
    return totals;
  }, [existingItems, departments]);

  const handleAddItem = () => {
    if (!newItem.department_id) {
      toast.error("Please select a department");
      return;
    }
    if (!newItem.grade_id) {
      toast.error("Please select a grade");
      return;
    }
    if (selectedDates.length === 0) {
      toast.error("Please select at least one date");
      return;
    }

    const requiredHrs = newItem.machine_id 
      ? calculateRequiredHours(newItem.planned_qty_dozens, newItem.machine_id)
      : 0;

    // Create an item for each selected date
    const newItems: PlanItem[] = selectedDates.map(date => ({
      department_id: newItem.department_id,
      machine_id: newItem.machine_id,
      grade_id: newItem.grade_id,
      planning_item_id: newItem.planning_item_id,
      planned_date: date,
      planned_qty_dozens: newItem.planned_qty_dozens,
      capacity_required_hrs: requiredHrs,
      priority: newItem.priority,
      remarks: newItem.remarks,
    }));

    setPlanItems([...planItems, ...newItems]);
    setNewItem({
      department_id: "",
      machine_id: "",
      grade_id: "",
      planning_item_id: "",
      planned_qty_dozens: 0,
      capacity_required_hrs: 0,
      priority: "medium",
      remarks: "",
    });
    setSelectedDates([]);
    setIsAddOpen(false);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      for (const item of planItems) {
        const { error } = await supabase.from("production_planning_items").insert({
          department_id: item.department_id || null,
          machine_id: item.machine_id || null,
          grade_id: item.grade_id || null,
          planning_item_id: item.planning_item_id || null,
          planned_date: item.planned_date,
          planned_qty_dozens: item.planned_qty_dozens,
          capacity_required_hrs: item.capacity_required_hrs,
          priority: item.priority,
          remarks: item.remarks || null,
        } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning-items"] });
      toast.success("Plan items saved");
      setPlanItems([]);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save plan");
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("production_planning_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning-items"] });
      toast.success("Item deleted");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete");
    },
  });

  const removeUnsavedItem = (index: number) => {
    setPlanItems(planItems.filter((_, i) => i !== index));
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high":
        return "destructive";
      case "low":
        return "secondary";
      default:
        return "default";
    }
  };

  // Filter departments for display - show all if none selected, otherwise show selected
  const displayDepartments = useMemo(() => {
    if (selectedDepartments.length === 0) return departments || [];
    return departments?.filter((d: any) => selectedDepartments.includes(d.id)) || [];
  }, [departments, selectedDepartments]);

  // Toggle department selection
  const toggleDepartment = (deptId: string) => {
    setSelectedDepartments(prev => 
      prev.includes(deptId) 
        ? prev.filter(id => id !== deptId)
        : [...prev, deptId]
    );
  };

  // Select/deselect all departments
  const toggleAllDepartments = () => {
    if (selectedDepartments.length === departments?.length) {
      setSelectedDepartments([]);
    } else {
      setSelectedDepartments(departments?.map((d: any) => d.id) || []);
    }
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Weekly Production Planning"
          description="Plan department-wise production with machine capacity"
        >
          <Button onClick={() => setIsAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Plan Item
          </Button>
          {planItems.length > 0 && (
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              <Save className="h-4 w-4 mr-2" />
              Save Plan
            </Button>
          )}
        </PageHeader>

        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Plan Item</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Department *</Label>
                <Select
                  value={newItem.department_id}
                  onValueChange={(v) => setNewItem({ ...newItem, department_id: v, machine_id: "" })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments?.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Machine (Optional)</Label>
                <Select
                  value={newItem.machine_id || ""}
                  onValueChange={(v) => setNewItem({ ...newItem, machine_id: v })}
                  disabled={!newItem.department_id}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select machine for capacity" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredMachines?.map((m: any) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.code} - {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {newItem.machine_id && (
                  <p className="text-xs text-muted-foreground">
                    Capacity: {getCapacityPerHour(newItem.machine_id)} dzn/hr
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Item</Label>
                <Select
                  value={newItem.planning_item_id || ""}
                  onValueChange={(v) => setNewItem({ ...newItem, planning_item_id: v })}
                  disabled={!newItem.department_id}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select item (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredPlanningItems?.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.code} - {p.name} ({p.unit || 'dzns'})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {newItem.department_id && filteredPlanningItems?.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No items for this department. Add items in Item Master.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Grade *</Label>
                <Select
                  value={newItem.grade_id}
                  onValueChange={(v) => setNewItem({ ...newItem, grade_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select grade" />
                  </SelectTrigger>
                  <SelectContent>
                    {grades?.map((g: any) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.code} - {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Planned Dates *</Label>
                <div className="grid grid-cols-3 gap-2 border rounded-lg p-3">
                  {weekDays.map((day) => {
                    const dateKey = format(day, "yyyy-MM-dd");
                    const isSelected = selectedDates.includes(dateKey);
                    return (
                      <div
                        key={dateKey}
                        className="flex items-center gap-2"
                      >
                        <Checkbox
                          id={`date-${dateKey}`}
                          checked={isSelected}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedDates([...selectedDates, dateKey]);
                            } else {
                              setSelectedDates(selectedDates.filter(d => d !== dateKey));
                            }
                          }}
                        />
                        <label
                          htmlFor={`date-${dateKey}`}
                          className="text-sm cursor-pointer"
                        >
                          {format(day, "EEE, dd MMM")}
                        </label>
                      </div>
                    );
                  })}
                </div>
                {selectedDates.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {selectedDates.length} date(s) selected - item will be created for each date
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Planned Qty</Label>
                <Input
                  type="number"
                  value={newItem.planned_qty_dozens}
                  onChange={(e) =>
                    setNewItem({ ...newItem, planned_qty_dozens: Number(e.target.value) })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={newItem.priority}
                  onValueChange={(v) => setNewItem({ ...newItem, priority: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Remarks</Label>
                <Textarea
                  value={newItem.remarks}
                  onChange={(e) => setNewItem({ ...newItem, remarks: e.target.value })}
                  placeholder="Optional notes..."
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddItem}>Add</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Week Navigation with Department Filter */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              {/* Week Navigation - centered on mobile */}
              <div className="flex items-center justify-between lg:justify-start gap-2 order-1 lg:order-none">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedWeek(subWeeks(selectedWeek, 1))}
                >
                  <ChevronLeft className="h-4 w-4 lg:mr-1" />
                  <span className="hidden lg:inline">Previous</span>
                </Button>
                <div className="flex items-center gap-2 lg:hidden">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">
                    {format(weekStart, "dd MMM")} - {format(weekEnd, "dd MMM")}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedWeek(addWeeks(selectedWeek, 1))}
                >
                  <span className="hidden lg:inline">Next</span>
                  <ChevronRight className="h-4 w-4 lg:ml-1" />
                </Button>
              </div>

              {/* Week Label - desktop only */}
              <div className="hidden lg:flex items-center gap-2">
                <Calendar className="h-5 w-5 text-muted-foreground" />
                <span className="text-lg font-semibold">
                  Week: {format(weekStart, "dd MMM")} - {format(weekEnd, "dd MMM yyyy")}
                </span>
              </div>

              {/* Department Filter */}
              <div className="flex items-center gap-2 order-2 lg:order-none">
                <Label className="text-sm font-medium whitespace-nowrap hidden sm:block">Departments:</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full sm:w-[200px] lg:w-[250px] justify-between">
                      <span className="truncate">
                        {selectedDepartments.length === 0 
                          ? "All Departments" 
                          : selectedDepartments.length === departments?.length
                            ? "All Departments"
                            : `${selectedDepartments.length} selected`}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[250px] p-0" align="start">
                    <div className="p-2 border-b">
                      <div 
                        className="flex items-center gap-2 p-2 rounded-md hover:bg-accent cursor-pointer"
                        onClick={toggleAllDepartments}
                      >
                        <Checkbox 
                          checked={selectedDepartments.length === 0 || selectedDepartments.length === departments?.length}
                        />
                        <span className="font-medium">All Departments</span>
                      </div>
                    </div>
                    <div className="max-h-[300px] overflow-y-auto p-2">
                      {departments?.map((d: any) => (
                        <div 
                          key={d.id}
                          className="flex items-center gap-2 p-2 rounded-md hover:bg-accent cursor-pointer"
                          onClick={() => toggleDepartment(d.id)}
                        >
                          <Checkbox checked={selectedDepartments.includes(d.id)} />
                          <span>{d.name}</span>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Unsaved Items */}
        {planItems.length > 0 && (
          <Card className="border-primary">
            <CardHeader>
              <CardTitle className="text-primary">Unsaved Plan Items ({planItems.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Mobile Card View */}
              <div className="lg:hidden space-y-3">
                {planItems.map((item, idx) => {
                  const dept = departments?.find((d: any) => d.id === item.department_id);
                  const machine = machines?.find((m: any) => m.id === item.machine_id);
                  const grade = grades?.find((g: any) => g.id === item.grade_id);
                  const planningItem = planningItems?.find((p: any) => p.id === item.planning_item_id);
                  return (
                    <div key={idx} className="p-3 border rounded-lg bg-muted/30">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="font-semibold">{format(new Date(item.planned_date), "EEE, dd MMM")}</div>
                          <div className="text-sm text-muted-foreground">{dept?.name}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={getPriorityColor(item.priority)}>{item.priority}</Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => removeUnsavedItem(idx)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {planningItem && (
                          <div>
                            <span className="text-muted-foreground">Item: </span>
                            <span className="font-medium">{planningItem.name}</span>
                          </div>
                        )}
                        <div>
                          <span className="text-muted-foreground">Grade: </span>
                          <span className="font-medium">{grade?.code || "-"}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Qty: </span>
                          <span className="font-medium">{item.planned_qty_dozens}</span>
                        </div>
                        {machine && (
                          <div>
                            <span className="text-muted-foreground">Machine: </span>
                            <span className="font-medium">{machine.code}</span>
                          </div>
                        )}
                      </div>
                      {item.remarks && (
                        <div className="text-xs text-muted-foreground mt-2 truncate">{item.remarks}</div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table View */}
              <div className="hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Machine</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead className="text-right">Qty (Dzn)</TableHead>
                      <TableHead className="text-right">Hrs Req</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Remarks</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {planItems.map((item, idx) => {
                      const dept = departments?.find((d: any) => d.id === item.department_id);
                      const machine = machines?.find((m: any) => m.id === item.machine_id);
                      const grade = grades?.find((g: any) => g.id === item.grade_id);
                      const planningItem = planningItems?.find((p: any) => p.id === item.planning_item_id);
                      return (
                        <TableRow key={idx}>
                          <TableCell>{format(new Date(item.planned_date), "EEE, dd MMM")}</TableCell>
                          <TableCell>{dept?.name || "-"}</TableCell>
                          <TableCell>{machine?.code || "-"}</TableCell>
                          <TableCell>{planningItem ? `${planningItem.name} (${planningItem.unit || 'dzns'})` : "-"}</TableCell>
                          <TableCell>{grade?.code || "-"}</TableCell>
                          <TableCell className="text-right">{item.planned_qty_dozens}</TableCell>
                          <TableCell className="text-right">{item.capacity_required_hrs}</TableCell>
                          <TableCell>
                            <Badge variant={getPriorityColor(item.priority)}>{item.priority}</Badge>
                          </TableCell>
                          <TableCell className="max-w-[150px] truncate" title={item.remarks}>{item.remarks || "-"}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeUnsavedItem(idx)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Department-wise Planning Grid */}
        <div className="space-y-6">
          {displayDepartments?.map((dept: any) => {
            const deptItems = itemsByDeptAndDay[dept.id] || {};
            const totals = departmentTotals[dept.id] || { qty: 0, hrs: 0 };
            
            return (
              <Card key={dept.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <Factory className="h-5 w-5 text-primary" />
                      <CardTitle className="text-base sm:text-lg">{dept.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-3 sm:gap-4 text-xs sm:text-sm">
                      <span className="text-muted-foreground">
                        Total: <span className="font-semibold text-foreground">{totals.qty}</span>
                      </span>
                      <span className="text-muted-foreground">
                        <span className="font-semibold text-foreground">{totals.hrs.toFixed(1)} hrs</span>
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-3 sm:px-6">
                  {/* Mobile: 2 columns, Tablet: 3 columns, Desktop: 6 columns */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    {weekDays.map((day) => {
                      const dateKey = format(day, "yyyy-MM-dd");
                      const dayItems = deptItems[dateKey] || [];
                      const dayQty = dayItems.reduce((sum: number, i: any) => sum + (Number(i.planned_qty_dozens) || 0), 0);

                      return (
                        <div key={dateKey} className="border rounded-lg p-2 min-h-[100px] sm:min-h-[120px]">
                          <div className="text-xs font-medium text-muted-foreground mb-2">
                            {format(day, "EEE dd")}
                          </div>
                          {dayItems.length === 0 ? (
                            <div className="text-xs text-muted-foreground/60 text-center py-2 sm:py-4">
                              No items
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {dayItems.map((item: any) => (
                                <div
                                  key={item.id}
                                  className={cn(
                                    "p-1 sm:p-1.5 rounded text-xs",
                                    item.priority === "high" && "bg-destructive/10 border-l-2 border-destructive",
                                    item.priority === "medium" && "bg-muted",
                                    item.priority === "low" && "bg-secondary/50"
                                  )}
                                >
                                  <div className="flex items-start justify-between gap-1">
                                    <div className="min-w-0 flex-1">
                                      {item.planning_items?.name && (
                                        <div className="font-semibold text-primary truncate text-[10px] sm:text-xs">
                                          {item.planning_items.name}
                                          <span className="text-muted-foreground font-normal ml-1 hidden sm:inline">
                                            ({item.planning_items.unit || 'dzns'})
                                          </span>
                                        </div>
                                      )}
                                      <div className="font-medium">{item.grades?.code || "-"}</div>
                                      <div className="text-muted-foreground">{item.planned_qty_dozens}</div>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-5 w-5 shrink-0"
                                      onClick={() => deleteItemMutation.mutate(item.id)}
                                    >
                                      <Trash2 className="h-3 w-3 text-destructive" />
                                    </Button>
                                  </div>
                                  {item.remarks && (
                                    <div className="text-muted-foreground mt-1 truncate hidden sm:block" title={item.remarks}>
                                      {item.remarks}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {dayQty > 0 && (
                            <div className="text-[10px] sm:text-xs font-semibold text-primary mt-2 pt-1 border-t">
                              Total: {dayQty}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </ERPLayout>
  );
}
