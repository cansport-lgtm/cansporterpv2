import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PackageCheck, Plus, Pencil, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface WIPEntry {
  id: string;
  entry_date: string;
  department_id: string | null;
  grade_id: string | null;
  opening_qty: number;
  received_qty: number;
  produced_qty: number;
  transferred_qty: number;
  closing_qty: number;
  process_stage: string | null;
  status: string | null;
  uom_id: string | null;
  created_at: string;
  updated_at: string;
  production_departments?: { name: string } | null;
  grades?: { name: string } | null;
}

const PROCESS_STAGES = [
  { value: "cutting", label: "Cutting" },
  { value: "stitching", label: "Stitching" },
  { value: "finishing", label: "Finishing" },
  { value: "packing", label: "Packing" },
  { value: "quality_check", label: "Quality Check" },
];

const STATUS_OPTIONS = [
  { value: "in_process", label: "In Process" },
  { value: "completed", label: "Completed" },
  { value: "transferred", label: "Transferred" },
];

export default function WIPInventoryPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<WIPEntry | null>(null);
  const [activeTab, setActiveTab] = useState("in_process");
  const [useCustomStage, setUseCustomStage] = useState(false);
  const [formData, setFormData] = useState({
    department_id: "",
    grade_id: "",
    process_stage: "cutting",
    opening_qty: "",
    received_qty: "",
    produced_qty: "",
    transferred_qty: "",
    entry_date: format(new Date(), "yyyy-MM-dd"),
    status: "in_process",
    remarks: "",
  });

  const { data: wipEntries = [] } = useQuery({
    queryKey: ["wip-inventory"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wip_inventory")
        .select(`
          *,
          production_departments(name),
          grades(name)
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as WIPEntry[];
    },
  });

  const { data: grades = [] } = useQuery({
    queryKey: ["grades"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grades")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["production-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const payload = {
        department_id: data.department_id || null,
        grade_id: data.grade_id || null,
        process_stage: data.process_stage,
        opening_qty: parseFloat(data.opening_qty || "0"),
        received_qty: parseFloat(data.received_qty || "0"),
        produced_qty: parseFloat(data.produced_qty || "0"),
        transferred_qty: parseFloat(data.transferred_qty || "0"),
        closing_qty: parseFloat(data.opening_qty || "0") + parseFloat(data.received_qty || "0") + parseFloat(data.produced_qty || "0") - parseFloat(data.transferred_qty || "0"),
        entry_date: data.entry_date,
        status: data.status,
      };

      if (data.id) {
        const { error } = await supabase
          .from("wip_inventory")
          .update(payload)
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("wip_inventory").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wip-inventory"] });
      toast.success(selectedEntry ? "WIP entry updated" : "WIP entry created");
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const markCompletedMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("wip_inventory")
        .update({ status: "completed" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wip-inventory"] });
      toast.success("Entry marked as completed");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      department_id: "",
      grade_id: "",
      process_stage: "cutting",
      opening_qty: "",
      received_qty: "",
      produced_qty: "",
      transferred_qty: "",
      entry_date: format(new Date(), "yyyy-MM-dd"),
      status: "in_process",
      remarks: "",
    });
    setSelectedEntry(null);
    setDialogOpen(false);
    setUseCustomStage(false);
  };

  const handleEdit = (entry: WIPEntry) => {
    setSelectedEntry(entry);
    const isCustomStage = !PROCESS_STAGES.some(s => s.value === entry.process_stage);
    setUseCustomStage(isCustomStage);
    setFormData({
      department_id: entry.department_id || "",
      grade_id: entry.grade_id || "",
      process_stage: entry.process_stage || "cutting",
      opening_qty: entry.opening_qty.toString(),
      received_qty: entry.received_qty.toString(),
      produced_qty: entry.produced_qty.toString(),
      transferred_qty: entry.transferred_qty.toString(),
      entry_date: entry.entry_date,
      status: entry.status || "in_process",
      remarks: "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.process_stage) {
      toast.error("Process stage is required");
      return;
    }
    saveMutation.mutate(
      selectedEntry ? { ...formData, id: selectedEntry.id } : formData
    );
  };

  // Filter entries by status
  const filteredEntries = wipEntries.filter((entry) => {
    if (activeTab === "all") return true;
    return entry.status === activeTab;
  });

  // Summary by stage
  const stagesSummary = PROCESS_STAGES.map((stage) => ({
    ...stage,
    count: wipEntries.filter(
      (e) => e.process_stage === stage.value && e.status === "in_process"
    ).length,
    quantity: wipEntries
      .filter((e) => e.process_stage === stage.value && e.status === "in_process")
      .reduce((sum, e) => sum + Number(e.closing_qty), 0),
  }));

  const columns = [
    {
      key: "entry_date",
      header: "Date",
      render: (item: WIPEntry) => format(new Date(item.entry_date), "dd MMM yyyy"),
    },
    {
      key: "grades",
      header: "Grade",
      render: (item: WIPEntry) => item.grades?.name || "-",
    },
    {
      key: "production_departments",
      header: "Department",
      render: (item: WIPEntry) => item.production_departments?.name || "-",
    },
    {
      key: "process_stage",
      header: "Stage",
      render: (item: WIPEntry) =>
        PROCESS_STAGES.find((s) => s.value === item.process_stage)?.label || item.process_stage || "-",
    },
    {
      key: "opening_qty",
      header: "Opening",
      render: (item: WIPEntry) => item.opening_qty.toLocaleString(),
    },
    {
      key: "received_qty",
      header: "Received",
      render: (item: WIPEntry) => item.received_qty.toLocaleString(),
    },
    {
      key: "produced_qty",
      header: "Produced",
      render: (item: WIPEntry) => item.produced_qty.toLocaleString(),
    },
    {
      key: "transferred_qty",
      header: "Transferred",
      render: (item: WIPEntry) => item.transferred_qty.toLocaleString(),
    },
    {
      key: "closing_qty",
      header: "Closing",
      render: (item: WIPEntry) => (
        <span className="font-semibold">{item.closing_qty.toLocaleString()}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (item: WIPEntry) => {
        const status = item.status === "completed"
          ? "approved"
          : item.status === "transferred"
          ? "closed"
          : "in_progress";
        return <StatusBadge status={status} />;
      },
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: WIPEntry) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => handleEdit(row)}>
            <Pencil className="h-4 w-4" />
          </Button>
          {row.status === "in_process" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => markCompletedMutation.mutate(row.id)}
              title="Mark as completed"
            >
              <CheckCircle className="h-4 w-4 text-primary" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="WIP Inventory"
        description="Track work-in-progress inventory across production stages"
        icon={PackageCheck}
        action={{
          label: "Add WIP Entry",
          onClick: () => setDialogOpen(true),
          icon: Plus,
        }}
      />

      {/* Stage Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {stagesSummary.map((stage) => (
          <Card key={stage.value}>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">{stage.label}</p>
              <p className="text-2xl font-bold">{stage.quantity.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">
                {stage.count} entries
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs for filtering */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
        <TabsList>
          <TabsTrigger value="in_process">In Process</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="transferred">Transferred</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <DataTable columns={columns} data={filteredEntries} />

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedEntry ? "Edit WIP Entry" : "Add WIP Entry"}
            </DialogTitle>
            <DialogDescription>
              Track work-in-progress inventory
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Entry Date</Label>
                <Input
                  type="date"
                  value={formData.entry_date}
                  onChange={(e) =>
                    setFormData({ ...formData, entry_date: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Process Stage *</Label>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Custom</Label>
                    <Switch
                      checked={useCustomStage}
                      onCheckedChange={(checked) => {
                        setUseCustomStage(checked);
                        if (!checked) {
                          setFormData({ ...formData, process_stage: "cutting" });
                        } else {
                          setFormData({ ...formData, process_stage: "" });
                        }
                      }}
                    />
                  </div>
                </div>
                {useCustomStage ? (
                  <Input
                    value={formData.process_stage}
                    onChange={(e) =>
                      setFormData({ ...formData, process_stage: e.target.value })
                    }
                    placeholder="Enter custom stage name"
                  />
                ) : (
                  <Select
                    value={formData.process_stage}
                    onValueChange={(value) =>
                      setFormData({ ...formData, process_stage: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROCESS_STAGES.map((stage) => (
                        <SelectItem key={stage.value} value={stage.value}>
                          {stage.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Department</Label>
                <Select
                  value={formData.department_id}
                  onValueChange={(value) =>
                    setFormData({ ...formData, department_id: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((dept: any) => (
                      <SelectItem key={dept.id} value={dept.id}>
                        {dept.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Grade</Label>
                <Select
                  value={formData.grade_id}
                  onValueChange={(value) =>
                    setFormData({ ...formData, grade_id: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select grade" />
                  </SelectTrigger>
                  <SelectContent>
                    {grades.map((grade: any) => (
                      <SelectItem key={grade.id} value={grade.id}>
                        {grade.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Opening Qty</Label>
                <Input
                  type="number"
                  value={formData.opening_qty}
                  onChange={(e) =>
                    setFormData({ ...formData, opening_qty: e.target.value })
                  }
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Received Qty</Label>
                <Input
                  type="number"
                  value={formData.received_qty}
                  onChange={(e) =>
                    setFormData({ ...formData, received_qty: e.target.value })
                  }
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Produced Qty</Label>
                <Input
                  type="number"
                  value={formData.produced_qty}
                  onChange={(e) =>
                    setFormData({ ...formData, produced_qty: e.target.value })
                  }
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Transferred Qty</Label>
                <Input
                  type="number"
                  value={formData.transferred_qty}
                  onChange={(e) =>
                    setFormData({ ...formData, transferred_qty: e.target.value })
                  }
                  placeholder="0"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value) =>
                  setFormData({ ...formData, status: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={resetForm}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={saveMutation.isPending}>
                {selectedEntry ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
