import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  CalendarIcon,
  Trash2,
  Copy,
  CheckCircle2,
  Clock,
  Target,
  Pencil,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface PlanItem {
  id: string;
  department_id: string | null;
  process_id: string | null;
  grade_id: string | null;
  target_inspections: number;
  completed_inspections: number;
  priority: string;
  notes: string | null;
  assigned_to: string | null;
  production_departments?: { name: string } | null;
  qa_processes?: { name: string } | null;
  grades?: { name: string } | null;
  app_users?: { full_name: string } | null;
}

interface TemplateItem {
  id?: string;
  department_id: string | null;
  process_id: string | null;
  grade_id: string | null;
  target_inspections: number;
  priority: string;
  notes: string | null;
  assigned_to: string | null;
}

export default function DailyQualityPlanPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  // Tab state
  const [activeTab, setActiveTab] = useState("plans");
  
  // Plan states
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [selectedShift, setSelectedShift] = useState("Day");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [planRemarks, setPlanRemarks] = useState("");
  const [planItems, setPlanItems] = useState<TemplateItem[]>([]);
  const [deletePlanId, setDeletePlanId] = useState<string | null>(null);
  
  // Template states
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateItems, setTemplateItems] = useState<TemplateItem[]>([]);
  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);

  // Fetch departments
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

  // Fetch processes
  const { data: processes = [] } = useQuery({
    queryKey: ["qa-processes"],
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

  // Fetch app users for assignment
  const { data: appUsers = [] } = useQuery({
    queryKey: ["app-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_users")
        .select("id, full_name, designation")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch templates
  const { data: templates = [] } = useQuery({
    queryKey: ["qa-plan-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_plan_templates")
        .select("*, app_users(full_name)")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch daily plans
  const { data: dailyPlans = [] } = useQuery({
    queryKey: ["qa-daily-plans", format(selectedDate, "yyyy-MM")],
    queryFn: async () => {
      const monthStart = format(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1), "yyyy-MM-dd");
      const monthEnd = format(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0), "yyyy-MM-dd");
      
      const { data, error } = await supabase
        .from("qa_daily_plans")
        .select("*, app_users!qa_daily_plans_created_by_fkey(full_name), qa_plan_templates(name)")
        .gte("plan_date", monthStart)
        .lte("plan_date", monthEnd)
        .order("plan_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch plan items for selected plan
  const selectedPlan = dailyPlans.find(
    (p) => format(new Date(p.plan_date), "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd")
  );

  const { data: selectedPlanItems = [] } = useQuery({
    queryKey: ["qa-daily-plan-items", selectedPlan?.id],
    queryFn: async () => {
      if (!selectedPlan?.id) return [];
      const { data, error } = await supabase
        .from("qa_daily_plan_items")
        .select("*, production_departments(name), qa_processes(name), grades(name), app_users!qa_daily_plan_items_assigned_to_fkey(full_name)")
        .eq("plan_id", selectedPlan.id);
      if (error) throw error;
      return data as PlanItem[];
    },
    enabled: !!selectedPlan?.id,
  });

  // Fetch actual inspections for the selected date to calculate completion (with inspector info)
  const { data: actualInspections = [] } = useQuery({
    queryKey: ["qa-inspections-for-plan", format(selectedDate, "yyyy-MM-dd")],
    queryFn: async () => {
      const dateStr = format(selectedDate, "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("qa_inspections")
        .select("process_id, grade_id, inspector_id")
        .eq("inspection_date", dateStr);
      if (error) throw error;
      return data;
    },
  });

  // Create plan mutation
  const createPlanMutation = useMutation({
    mutationFn: async () => {
      const dateStr = format(selectedDate, "yyyy-MM-dd");
      
      // Create the plan
      const { data: plan, error: planError } = await supabase
        .from("qa_daily_plans")
        .insert({
          plan_date: dateStr,
          shift: selectedShift,
          template_id: selectedTemplateId || null,
          remarks: planRemarks || null,
          created_by: user?.id,
          status: "active",
        })
        .select()
        .single();
      
      if (planError) throw planError;
      
      // Create plan items
      if (planItems.length > 0) {
        const itemsToInsert = planItems.map((item) => ({
          plan_id: plan.id,
          department_id: item.department_id || null,
          process_id: item.process_id || null,
          grade_id: item.grade_id || null,
          target_inspections: item.target_inspections,
          priority: item.priority,
          notes: item.notes || null,
          assigned_to: item.assigned_to || null,
        }));
        
        const { error: itemsError } = await supabase
          .from("qa_daily_plan_items")
          .insert(itemsToInsert);
        
        if (itemsError) throw itemsError;
      }
      
      return plan;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-daily-plans"] });
      queryClient.invalidateQueries({ queryKey: ["qa-daily-plan-items"] });
      toast.success("Daily quality plan created successfully");
      resetPlanForm();
    },
    onError: (error: any) => {
      if (error.code === "23505") {
        toast.error("A plan already exists for this date and shift");
      } else {
        toast.error("Failed to create plan: " + error.message);
      }
    },
  });

  // Update plan mutation
  const updatePlanMutation = useMutation({
    mutationFn: async () => {
      if (!editingPlanId) throw new Error("No plan to update");
      
      // Update the plan
      const { error: planError } = await supabase
        .from("qa_daily_plans")
        .update({
          shift: selectedShift,
          template_id: selectedTemplateId || null,
          remarks: planRemarks || null,
        })
        .eq("id", editingPlanId);
      
      if (planError) throw planError;
      
      // Delete existing plan items
      const { error: deleteError } = await supabase
        .from("qa_daily_plan_items")
        .delete()
        .eq("plan_id", editingPlanId);
      
      if (deleteError) throw deleteError;
      
      // Insert updated plan items
      if (planItems.length > 0) {
        const itemsToInsert = planItems.map((item) => ({
          plan_id: editingPlanId,
          department_id: item.department_id || null,
          process_id: item.process_id || null,
          grade_id: item.grade_id || null,
          target_inspections: item.target_inspections,
          priority: item.priority,
          notes: item.notes || null,
          assigned_to: item.assigned_to || null,
        }));
        
        const { error: itemsError } = await supabase
          .from("qa_daily_plan_items")
          .insert(itemsToInsert);
        
        if (itemsError) throw itemsError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-daily-plans"] });
      queryClient.invalidateQueries({ queryKey: ["qa-daily-plan-items"] });
      toast.success("Daily quality plan updated successfully");
      resetPlanForm();
    },
    onError: (error: any) => {
      toast.error("Failed to update plan: " + error.message);
    },
  });

  // Delete plan mutation
  const deletePlanMutation = useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase
        .from("qa_daily_plans")
        .delete()
        .eq("id", planId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-daily-plans"] });
      queryClient.invalidateQueries({ queryKey: ["qa-daily-plan-items"] });
      toast.success("Plan deleted successfully");
      setDeletePlanId(null);
    },
    onError: (error: any) => {
      toast.error("Failed to delete plan: " + error.message);
    },
  });

  // Create template mutation
  const createTemplateMutation = useMutation({
    mutationFn: async () => {
      // Create template
      const { data: template, error: templateError } = await supabase
        .from("qa_plan_templates")
        .insert({
          name: templateName,
          description: templateDescription || null,
          created_by: user?.id,
        })
        .select()
        .single();
      
      if (templateError) throw templateError;
      
      // Create template items
      if (templateItems.length > 0) {
        const itemsToInsert = templateItems.map((item) => ({
          template_id: template.id,
          department_id: item.department_id || null,
          process_id: item.process_id || null,
          grade_id: item.grade_id || null,
          target_inspections: item.target_inspections,
          priority: item.priority,
          notes: item.notes || null,
          assigned_to: item.assigned_to || null,
        }));
        
        const { error: itemsError } = await supabase
          .from("qa_plan_template_items")
          .insert(itemsToInsert);
        
        if (itemsError) throw itemsError;
      }
      
      return template;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-plan-templates"] });
      toast.success("Template created successfully");
      resetTemplateForm();
    },
    onError: (error: any) => {
      toast.error("Failed to create template: " + error.message);
    },
  });

  // Delete template mutation
  const deleteTemplateMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const { error } = await supabase
        .from("qa_plan_templates")
        .update({ is_active: false })
        .eq("id", templateId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-plan-templates"] });
      toast.success("Template deleted successfully");
      setDeleteTemplateId(null);
    },
    onError: (error: any) => {
      toast.error("Failed to delete template: " + error.message);
    },
  });

  // Load template items when template is selected
  const handleTemplateSelect = async (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (templateId) {
      const { data, error } = await supabase
        .from("qa_plan_template_items")
        .select("*")
        .eq("template_id", templateId);
      
      if (!error && data) {
        setPlanItems(data.map((item: any) => ({
          department_id: item.department_id,
          process_id: item.process_id,
          grade_id: item.grade_id,
          target_inspections: item.target_inspections,
          priority: item.priority || "medium",
          notes: item.notes,
          assigned_to: item.assigned_to,
        })));
      }
    } else {
      setPlanItems([]);
    }
  };

  const resetPlanForm = () => {
    setPlanDialogOpen(false);
    setEditingPlanId(null);
    setSelectedTemplateId("");
    setPlanRemarks("");
    setPlanItems([]);
  };

  // Load plan for editing
  const handleEditPlan = async (plan: any) => {
    setEditingPlanId(plan.id);
    setSelectedDate(new Date(plan.plan_date));
    setSelectedShift(plan.shift);
    setSelectedTemplateId(plan.template_id || "");
    setPlanRemarks(plan.remarks || "");
    
    // Fetch plan items
    const { data, error } = await supabase
      .from("qa_daily_plan_items")
      .select("*")
      .eq("plan_id", plan.id);
    
    if (!error && data) {
      setPlanItems(data.map((item: any) => ({
        id: item.id,
        department_id: item.department_id,
        process_id: item.process_id,
        grade_id: item.grade_id,
        target_inspections: item.target_inspections,
        priority: item.priority || "medium",
        notes: item.notes,
        assigned_to: item.assigned_to,
      })));
    }
    
    setPlanDialogOpen(true);
  };

  // Handle save (create or update)
  const handleSavePlan = () => {
    if (editingPlanId) {
      updatePlanMutation.mutate();
    } else {
      createPlanMutation.mutate();
    }
  };

  const resetTemplateForm = () => {
    setTemplateDialogOpen(false);
    setTemplateName("");
    setTemplateDescription("");
    setTemplateItems([]);
  };

  const addPlanItem = () => {
    setPlanItems([...planItems, {
      department_id: null,
      process_id: null,
      grade_id: null,
      target_inspections: 1,
      priority: "medium",
      notes: null,
      assigned_to: null,
    }]);
  };

  const updatePlanItem = (index: number, field: keyof TemplateItem, value: any) => {
    const updated = [...planItems];
    updated[index] = { ...updated[index], [field]: value };
    setPlanItems(updated);
  };

  const removePlanItem = (index: number) => {
    setPlanItems(planItems.filter((_, i) => i !== index));
  };

  const addTemplateItem = () => {
    setTemplateItems([...templateItems, {
      department_id: null,
      process_id: null,
      grade_id: null,
      target_inspections: 1,
      priority: "medium",
      notes: null,
      assigned_to: null,
    }]);
  };

  const updateTemplateItem = (index: number, field: keyof TemplateItem, value: any) => {
    const updated = [...templateItems];
    updated[index] = { ...updated[index], [field]: value };
    setTemplateItems(updated);
  };

  const removeTemplateItem = (index: number) => {
    setTemplateItems(templateItems.filter((_, i) => i !== index));
  };

  // Calculate completion stats
  const calculateCompletion = (item: PlanItem) => {
    const matchingInspections = actualInspections.filter(
      (insp) => insp.process_id === item.process_id && 
               (item.grade_id ? insp.grade_id === item.grade_id : true)
    ).length;
    return Math.min(matchingInspections, item.target_inspections);
  };

  const totalTarget = selectedPlanItems.reduce((sum, item) => sum + item.target_inspections, 0);
  const totalCompleted = selectedPlanItems.reduce((sum, item) => sum + calculateCompletion(item), 0);
  const overallProgress = totalTarget > 0 ? (totalCompleted / totalTarget) * 100 : 0;

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high": return "destructive";
      case "medium": return "default";
      case "low": return "secondary";
      default: return "default";
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active": return <Badge className="bg-green-100 text-green-800">Active</Badge>;
      case "completed": return <Badge className="bg-blue-100 text-blue-800">Completed</Badge>;
      case "draft": return <Badge variant="secondary">Draft</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const planColumns = [
    { key: "plan_date", header: "Date", render: (p: any) => format(new Date(p.plan_date), "dd MMM yyyy") },
    { key: "shift", header: "Shift" },
    { key: "template", header: "Template", render: (p: any) => p.qa_plan_templates?.name || "-" },
    { key: "status", header: "Status", render: (p: any) => getStatusBadge(p.status) },
    { key: "created_by", header: "Created By", render: (p: any) => p.app_users?.full_name || "-" },
    {
      key: "actions",
      header: "Actions",
      render: (p: any) => (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              handleEditPlan(p);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              setDeletePlanId(p.id);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const templateColumns = [
    { key: "name", header: "Template Name" },
    { key: "description", header: "Description", render: (t: any) => t.description || "-" },
    { key: "created_by", header: "Created By", render: (t: any) => t.app_users?.full_name || "-" },
    {
      key: "actions",
      header: "Actions",
      render: (t: any) => (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              // Copy template to create a plan
              handleTemplateSelect(t.id);
              setPlanDialogOpen(true);
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDeleteTemplateId(t.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Daily Quality Plan"
          description="Plan and track daily quality inspections"
          icon={Target}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="plans">Daily Plans</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
          </TabsList>

          <TabsContent value="plans" className="space-y-4">
            {/* Date Picker and Summary Cards */}
            <div className="flex flex-col md:flex-row gap-4 items-start">
              <Card className="w-full md:w-auto">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Label>Select Date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="justify-start text-left font-normal">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {format(selectedDate, "PPP")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={selectedDate}
                          onSelect={(date) => date && setSelectedDate(date)}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <Button onClick={() => setPlanDialogOpen(true)} className="w-full">
                    <Plus className="mr-2 h-4 w-4" />
                    Create Plan
                  </Button>
                </CardContent>
              </Card>

              {selectedPlan && (
                <>
                  <Card className="flex-1">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Target className="h-4 w-4" />
                        Progress
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{totalCompleted} / {totalTarget}</div>
                      <Progress value={overallProgress} className="mt-2" />
                      <p className="text-sm text-muted-foreground mt-1">
                        {overallProgress.toFixed(1)}% completed
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="flex-1">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        Plan Status
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(selectedPlan.status)}
                        <span className="text-sm text-muted-foreground">
                          Shift: {selectedPlan.shift}
                        </span>
                      </div>
                      {selectedPlan.remarks && (
                        <p className="text-sm text-muted-foreground mt-2">{selectedPlan.remarks}</p>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </div>

            {/* Plan Items for Selected Date - Grouped by User */}
            {selectedPlan ? (
              <Card>
                <CardHeader>
                  <CardTitle>Plan Items - {format(selectedDate, "dd MMM yyyy")} (By Assigned User)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    {(() => {
                      // Group items by assigned user
                      const groupedByUser = selectedPlanItems.reduce((acc, item) => {
                        const userId = item.assigned_to || "__unassigned__";
                        const userName = item.app_users?.full_name || "Unassigned";
                        if (!acc[userId]) {
                          acc[userId] = { userName, items: [] };
                        }
                        acc[userId].items.push(item);
                        return acc;
                      }, {} as Record<string, { userName: string; items: PlanItem[] }>);

                      const userGroups = Object.entries(groupedByUser);

                      if (userGroups.length === 0) {
                        return (
                          <p className="text-center text-muted-foreground py-8">
                            No items in this plan
                          </p>
                        );
                      }

                      return userGroups.map(([userId, { userName, items }]) => {
                        // Calculate totals for this user
                        const totalTarget = items.reduce((sum, item) => sum + item.target_inspections, 0);
                        const totalActual = items.reduce((sum, item) => {
                          // Count inspections done by this assigned user matching the item criteria
                          return sum + actualInspections.filter((insp) => {
                            const processMatch = !item.process_id || insp.process_id === item.process_id;
                            const gradeMatch = !item.grade_id || insp.grade_id === item.grade_id;
                            const userMatch = userId === "__unassigned__" || insp.inspector_id === userId;
                            return processMatch && gradeMatch && userMatch;
                          }).length;
                        }, 0);
                        const userProgress = totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0;

                        return (
                          <div key={userId} className="border rounded-lg p-4 space-y-4">
                            {/* User Header */}
                            <div className="flex items-center justify-between border-b pb-3">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                                  <span className="text-lg">👤</span>
                                </div>
                                <div>
                                  <h3 className="font-semibold text-lg">{userName}</h3>
                                  <p className="text-sm text-muted-foreground">
                                    {items.length} target{items.length !== 1 ? "s" : ""} assigned
                                  </p>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="flex items-center gap-2">
                                  <span className="text-2xl font-bold">{totalActual}</span>
                                  <span className="text-muted-foreground">/</span>
                                  <span className="text-2xl font-bold text-muted-foreground">{totalTarget}</span>
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <Progress value={userProgress} className="w-32 h-2" />
                                  <span className="text-sm font-medium">
                                    {userProgress.toFixed(0)}%
                                  </span>
                                  {userProgress >= 100 && (
                                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* User's Items */}
                            <div className="space-y-2">
                              {items.map((item) => {
                                // Calculate completion for this specific item by this user
                                const itemActual = actualInspections.filter((insp) => {
                                  const processMatch = !item.process_id || insp.process_id === item.process_id;
                                  const gradeMatch = !item.grade_id || insp.grade_id === item.grade_id;
                                  const userMatch = userId === "__unassigned__" || insp.inspector_id === userId;
                                  return processMatch && gradeMatch && userMatch;
                                }).length;
                                const itemProgress = (itemActual / item.target_inspections) * 100;

                                return (
                                  <div key={item.id} className="flex items-center gap-4 p-3 bg-muted/50 rounded-md">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium">
                                          {item.qa_processes?.name || "All Processes"}
                                        </span>
                                        {item.grades?.name && (
                                          <Badge variant="outline">{item.grades.name}</Badge>
                                        )}
                                        <Badge variant={getPriorityColor(item.priority)}>
                                          {item.priority}
                                        </Badge>
                                      </div>
                                      {item.production_departments?.name && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                          Dept: {item.production_departments.name}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <div className="text-right min-w-[80px]">
                                        <span className="font-semibold">{itemActual}</span>
                                        <span className="text-muted-foreground"> / {item.target_inspections}</span>
                                      </div>
                                      <div className="w-24">
                                        <Progress value={itemProgress} className="h-2" />
                                      </div>
                                      {itemProgress >= 100 ? (
                                        <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                                      ) : (
                                        <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-8">
                  <p className="text-center text-muted-foreground">
                    No plan exists for {format(selectedDate, "dd MMM yyyy")}. 
                    Click "Create Plan" to add one.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Plans List */}
            <Card>
              <CardHeader>
                <CardTitle>All Plans This Month</CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={planColumns}
                  data={dailyPlans}
                  onRowClick={(plan) => setSelectedDate(new Date(plan.plan_date))}
                  emptyMessage="No plans found for this month"
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="templates" className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setTemplateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Template
              </Button>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Plan Templates</CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={templateColumns}
                  data={templates}
                  emptyMessage="No templates found. Create one to get started."
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Create/Edit Plan Dialog */}
        <Dialog open={planDialogOpen} onOpenChange={(open) => { if (!open) resetPlanForm(); else setPlanDialogOpen(true); }}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingPlanId ? "Edit Daily Quality Plan" : "Create Daily Quality Plan"}</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Date</Label>
                  <Input value={format(selectedDate, "yyyy-MM-dd")} disabled />
                </div>
                <div>
                  <Label>Shift</Label>
                  <Select value={selectedShift} onValueChange={setSelectedShift}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Day">Day</SelectItem>
                      <SelectItem value="Night">Night</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Use Template</Label>
                  <Select value={selectedTemplateId || "__none__"} onValueChange={(v) => handleTemplateSelect(v === "__none__" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select template (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Remarks</Label>
                <Textarea
                  value={planRemarks}
                  onChange={(e) => setPlanRemarks(e.target.value)}
                  placeholder="Optional remarks..."
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label>Plan Items</Label>
                  <Button variant="outline" size="sm" onClick={addPlanItem}>
                    <Plus className="mr-1 h-4 w-4" />
                    Add Item
                  </Button>
                </div>

                {planItems.map((item, index) => (
                  <div key={index} className="grid grid-cols-1 md:grid-cols-7 gap-2 p-3 border rounded-lg items-end">
                    <div>
                      <Label className="text-xs">Department</Label>
                      <Select
                        value={item.department_id || "__all__"}
                        onValueChange={(v) => updatePlanItem(index, "department_id", v === "__all__" ? null : v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All</SelectItem>
                          {departments.map((d) => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Process</Label>
                      <Select
                        value={item.process_id || "__none__"}
                        onValueChange={(v) => updatePlanItem(index, "process_id", v === "__none__" ? null : v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">All</SelectItem>
                          {processes
                            .filter((p) => !item.department_id || p.department_id === item.department_id)
                            .map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Grade</Label>
                      <Select
                        value={item.grade_id || "__all__"}
                        onValueChange={(v) => updatePlanItem(index, "grade_id", v === "__all__" ? null : v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All</SelectItem>
                          {grades.map((g) => (
                            <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Assign To</Label>
                      <Select
                        value={item.assigned_to || "__none__"}
                        onValueChange={(v) => updatePlanItem(index, "assigned_to", v === "__none__" ? null : v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select User" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Unassigned</SelectItem>
                          {appUsers.map((u) => (
                            <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Target</Label>
                      <Input
                        type="number"
                        min={1}
                        value={item.target_inspections}
                        onChange={(e) => updatePlanItem(index, "target_inspections", parseInt(e.target.value) || 1)}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Priority</Label>
                      <Select
                        value={item.priority}
                        onValueChange={(v) => updatePlanItem(index, "priority", v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removePlanItem(index)}
                      className="h-9"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                {planItems.length === 0 && (
                  <p className="text-center text-muted-foreground py-4 border rounded-lg">
                    No items added. Click "Add Item" to define inspection targets.
                  </p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={resetPlanForm}>Cancel</Button>
              <Button 
                onClick={handleSavePlan}
                disabled={createPlanMutation.isPending || updatePlanMutation.isPending}
              >
                {createPlanMutation.isPending || updatePlanMutation.isPending 
                  ? (editingPlanId ? "Updating..." : "Creating...") 
                  : (editingPlanId ? "Update Plan" : "Create Plan")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Template Dialog */}
        <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Plan Template</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Template Name *</Label>
                  <Input
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="e.g., Standard Daily Plan"
                  />
                </div>
                <div>
                  <Label>Description</Label>
                  <Input
                    value={templateDescription}
                    onChange={(e) => setTemplateDescription(e.target.value)}
                    placeholder="Optional description..."
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label>Template Items</Label>
                  <Button variant="outline" size="sm" onClick={addTemplateItem}>
                    <Plus className="mr-1 h-4 w-4" />
                    Add Item
                  </Button>
                </div>

                {templateItems.map((item, index) => (
                  <div key={index} className="grid grid-cols-1 md:grid-cols-6 gap-2 p-3 border rounded-lg items-end">
                    <div>
                      <Label className="text-xs">Department</Label>
                      <Select
                        value={item.department_id || "__all__"}
                        onValueChange={(v) => updateTemplateItem(index, "department_id", v === "__all__" ? null : v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All</SelectItem>
                          {departments.map((d) => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Process</Label>
                      <Select
                        value={item.process_id || "__none__"}
                        onValueChange={(v) => updateTemplateItem(index, "process_id", v === "__none__" ? null : v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">All</SelectItem>
                          {processes
                            .filter((p) => !item.department_id || p.department_id === item.department_id)
                            .map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Grade</Label>
                      <Select
                        value={item.grade_id || "__all__"}
                        onValueChange={(v) => updateTemplateItem(index, "grade_id", v === "__all__" ? null : v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All</SelectItem>
                          {grades.map((g) => (
                            <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Target</Label>
                      <Input
                        type="number"
                        min={1}
                        value={item.target_inspections}
                        onChange={(e) => updateTemplateItem(index, "target_inspections", parseInt(e.target.value) || 1)}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Priority</Label>
                      <Select
                        value={item.priority}
                        onValueChange={(v) => updateTemplateItem(index, "priority", v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeTemplateItem(index)}
                      className="h-9"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                {templateItems.length === 0 && (
                  <p className="text-center text-muted-foreground py-4 border rounded-lg">
                    No items added. Click "Add Item" to define inspection targets.
                  </p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={resetTemplateForm}>Cancel</Button>
              <Button 
                onClick={() => createTemplateMutation.mutate()}
                disabled={createTemplateMutation.isPending || !templateName.trim()}
              >
                {createTemplateMutation.isPending ? "Creating..." : "Create Template"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Plan Confirmation */}
        <AlertDialog open={!!deletePlanId} onOpenChange={() => setDeletePlanId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Plan</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this plan? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deletePlanId && deletePlanMutation.mutate(deletePlanId)}
                className="bg-destructive text-destructive-foreground"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete Template Confirmation */}
        <AlertDialog open={!!deleteTemplateId} onOpenChange={() => setDeleteTemplateId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Template</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this template? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteTemplateId && deleteTemplateMutation.mutate(deleteTemplateId)}
                className="bg-destructive text-destructive-foreground"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ERPLayout>
  );
}
