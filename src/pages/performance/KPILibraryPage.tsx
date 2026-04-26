import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = [
  "Productivity",
  "Quality",
  "Attendance",
  "Behavior",
  "Skills",
  "Leadership",
  "Communication",
  "Other",
];

const MEASUREMENT_TYPES = [
  { value: "numeric", label: "Numeric (e.g., 100 units)" },
  { value: "percentage", label: "Percentage (e.g., 95%)" },
  { value: "rating", label: "Rating (1-5 scale)" },
  { value: "boolean", label: "Yes/No" },
];

const TARGET_DIRECTIONS = [
  { value: "higher", label: "Higher is better" },
  { value: "lower", label: "Lower is better" },
  { value: "exact", label: "Exact value required" },
];

interface KPIFormData {
  code: string;
  name: string;
  description: string;
  category: string;
  measurement_type: string;
  target_direction: string;
  min_value: string;
  max_value: string;
  unit: string;
  is_active: boolean;
}

export default function KPILibraryPage() {
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [selectedKPI, setSelectedKPI] = useState<any>(null);
  const [formData, setFormData] = useState<KPIFormData>({
    code: "",
    name: "",
    description: "",
    category: "",
    measurement_type: "numeric",
    target_direction: "higher",
    min_value: "",
    max_value: "",
    unit: "",
    is_active: true,
  });

  // Fetch KPIs
  const { data: kpis = [], isLoading } = useQuery({
    queryKey: ["performance-kpis"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_kpis")
        .select("*")
        .order("code");
      if (error) throw error;
      return data;
    },
  });

  // Generate next code
  const generateCode = async () => {
    const { data, error } = await supabase.rpc("generate_kpi_code");
    if (error) {
      console.error("Error generating code:", error);
      return "KPI001";
    }
    return data;
  };

  // Create/Update KPI mutation
  const kpiMutation = useMutation({
    mutationFn: async (data: KPIFormData & { id?: string }) => {
      const payload = {
        code: data.code,
        name: data.name,
        description: data.description || null,
        category: data.category || null,
        measurement_type: data.measurement_type,
        target_direction: data.target_direction,
        min_value: data.min_value ? parseFloat(data.min_value) : null,
        max_value: data.max_value ? parseFloat(data.max_value) : null,
        unit: data.unit || null,
        is_active: data.is_active,
      };

      if (data.id) {
        const { error } = await supabase
          .from("performance_kpis")
          .update(payload)
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("performance_kpis").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["performance-kpis"] });
      toast.success(selectedKPI ? "KPI updated!" : "KPI created!");
      setShowDialog(false);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      code: "",
      name: "",
      description: "",
      category: "",
      measurement_type: "numeric",
      target_direction: "higher",
      min_value: "",
      max_value: "",
      unit: "",
      is_active: true,
    });
    setSelectedKPI(null);
  };

  const handleAdd = async () => {
    resetForm();
    const code = await generateCode();
    setFormData((prev) => ({ ...prev, code }));
    setShowDialog(true);
  };

  const handleEdit = (kpi: any) => {
    setSelectedKPI(kpi);
    setFormData({
      code: kpi.code,
      name: kpi.name,
      description: kpi.description || "",
      category: kpi.category || "",
      measurement_type: kpi.measurement_type,
      target_direction: kpi.target_direction || "higher",
      min_value: kpi.min_value?.toString() || "",
      max_value: kpi.max_value?.toString() || "",
      unit: kpi.unit || "",
      is_active: kpi.is_active,
    });
    setShowDialog(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    kpiMutation.mutate({ ...formData, id: selectedKPI?.id });
  };

  const columns = [
    { key: "code", header: "Code" },
    { key: "name", header: "KPI Name" },
    { key: "category", header: "Category", render: (row: any) => row.category || "-" },
    {
      key: "measurement_type",
      header: "Type",
      render: (row: any) => {
        const type = MEASUREMENT_TYPES.find((t) => t.value === row.measurement_type);
        return type?.label.split(" ")[0] || row.measurement_type;
      },
    },
    { key: "unit", header: "Unit", render: (row: any) => row.unit || "-" },
    {
      key: "is_active",
      header: "Status",
      render: (row: any) => (
        <StatusBadge status={row.is_active ? "active" : "inactive"} />
      ),
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
          title="KPI Library"
          description="Define and manage Key Performance Indicators"
        >
          <Button onClick={handleAdd}>
            <Plus className="h-4 w-4 mr-2" />
            Add KPI
          </Button>
        </PageHeader>

        <DataTable
          columns={columns}
          data={kpis}
          emptyMessage="No KPIs found. Add your first KPI to get started."
        />

        {/* KPI Dialog */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {selectedKPI ? "Edit KPI" : "Add New KPI"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Code *</Label>
                  <Input
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder="KPI001"
                    required
                    disabled={!!selectedKPI}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(v) => setFormData({ ...formData, category: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>KPI Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Production Efficiency"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe what this KPI measures..."
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Measurement Type *</Label>
                  <Select
                    value={formData.measurement_type}
                    onValueChange={(v) => setFormData({ ...formData, measurement_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MEASUREMENT_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Target Direction</Label>
                  <Select
                    value={formData.target_direction}
                    onValueChange={(v) => setFormData({ ...formData, target_direction: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TARGET_DIRECTIONS.map((dir) => (
                        <SelectItem key={dir.value} value={dir.value}>
                          {dir.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Min Value</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.min_value}
                    onChange={(e) => setFormData({ ...formData, min_value: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max Value</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.max_value}
                    onChange={(e) => setFormData({ ...formData, max_value: e.target.value })}
                    placeholder="100"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Input
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    placeholder="%, hrs, pcs"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
                <Label>Active</Label>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={kpiMutation.isPending}>
                  {kpiMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
