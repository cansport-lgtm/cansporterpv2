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
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2 } from "lucide-react";

interface MonthlyKPI {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  weight: number;
  max_score: number;
  is_active: boolean;
}

export default function MonthlyKPIMasterPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingKPI, setEditingKPI] = useState<MonthlyKPI | null>(null);
  const [form, setForm] = useState({ code: "", name: "", description: "", category: "general", weight: "1", max_score: "100" });

  const { data: kpis = [], isLoading } = useQuery({
    queryKey: ["monthly-kpis"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_monthly_kpis")
        .select("*")
        .order("code");
      if (error) throw error;
      return data as MonthlyKPI[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (values: typeof form) => {
      const payload = {
        code: values.code,
        name: values.name,
        description: values.description || null,
        category: values.category || "general",
        weight: parseFloat(values.weight) || 1,
        max_score: parseFloat(values.max_score) || 100,
      };
      if (editingKPI) {
        const { error } = await supabase.from("performance_monthly_kpis").update(payload).eq("id", editingKPI.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("performance_monthly_kpis").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-kpis"] });
      toast({ title: editingKPI ? "KPI updated" : "KPI created" });
      setDialogOpen(false);
      resetForm();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("performance_monthly_kpis").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-kpis"] });
      toast({ title: "KPI deleted" });
    },
  });

  const resetForm = () => {
    setForm({ code: "", name: "", description: "", category: "general", weight: "1", max_score: "100" });
    setEditingKPI(null);
  };

  const openEdit = (kpi: MonthlyKPI) => {
    setEditingKPI(kpi);
    setForm({
      code: kpi.code,
      name: kpi.name,
      description: kpi.description || "",
      category: kpi.category || "general",
      weight: String(kpi.weight),
      max_score: String(kpi.max_score),
    });
    setDialogOpen(true);
  };

  const columns = [
    { header: "Code", key: "code" as const },
    { header: "Name", key: "name" as const },
    { header: "Category", key: "category" as const },
    { header: "Weight", key: "weight" as const },
    { header: "Max Score", key: "max_score" as const },
    {
      header: "Status",
      key: "is_active" as const,
      render: (item: MonthlyKPI) => (
        <Badge variant={item.is_active ? "default" : "secondary"}>
          {item.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      header: "Actions",
      key: "id" as const,
      render: (item: MonthlyKPI) => (
        <div className="flex gap-2">
          <Button size="icon" variant="ghost" onClick={() => openEdit(item)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => {
            if (confirm("Delete this KPI?")) deleteMutation.mutate(item.id);
          }}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Monthly KPI Master"
          description="Define KPIs for monthly performance tracking"
          action={{
            label: "Add KPI",
            onClick: () => { resetForm(); setDialogOpen(true); },
            icon: Plus,
          }}
        />
        <DataTable columns={columns} data={kpis} />

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingKPI ? "Edit KPI" : "Add Monthly KPI"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Code</Label>
                  <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="MK001" />
                </div>
                <div>
                  <Label>Category</Label>
                  <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="general" />
                </div>
              </div>
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="KPI Name" />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Weight</Label>
                  <Input type="number" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
                </div>
                <div>
                  <Label>Max Score</Label>
                  <Input type="number" value={form.max_score} onChange={(e) => setForm({ ...form, max_score: e.target.value })} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate(form)} disabled={!form.code || !form.name}>
                {editingKPI ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
