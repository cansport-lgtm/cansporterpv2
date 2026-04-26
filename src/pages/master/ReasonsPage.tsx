import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Database, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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

interface DefectReason {
  id: string;
  code: string;
  name: string;
  severity: string | null;
  is_active: boolean | null;
}

interface DowntimeReason {
  id: string;
  code: string;
  name: string;
  category: string | null;
  is_planned: boolean | null;
  is_active: boolean | null;
}

export default function ReasonsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("defect");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedDefect, setSelectedDefect] = useState<DefectReason | null>(null);
  const [selectedDowntime, setSelectedDowntime] = useState<DowntimeReason | null>(null);

  const [defectForm, setDefectForm] = useState({
    code: "",
    name: "",
    severity: "minor",
    is_active: true,
  });

  const [downtimeForm, setDowntimeForm] = useState({
    code: "",
    name: "",
    category: "",
    is_planned: false,
    is_active: true,
  });

  // Defect Reasons Query
  const { data: defectReasons = [], isLoading: loadingDefects } = useQuery({
    queryKey: ["defect_reasons"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("defect_reasons")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return data as DefectReason[];
    },
  });

  // Downtime Reasons Query
  const { data: downtimeReasons = [], isLoading: loadingDowntime } = useQuery({
    queryKey: ["downtime_reasons"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("downtime_reasons")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return data as DowntimeReason[];
    },
  });

  // Defect Mutations
  const saveDefectMutation = useMutation({
    mutationFn: async (data: typeof defectForm & { id?: string }) => {
      if (data.id) {
        const { error } = await supabase
          .from("defect_reasons")
          .update({
            code: data.code,
            name: data.name,
            severity: data.severity,
            is_active: data.is_active,
          })
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("defect_reasons").insert({
          code: data.code,
          name: data.name,
          severity: data.severity,
          is_active: data.is_active,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["defect_reasons"] });
      toast.success(selectedDefect ? "Defect reason updated" : "Defect reason created");
      resetDefectForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteDefectMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("defect_reasons").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["defect_reasons"] });
      toast.success("Defect reason deleted");
      setDeleteDialogOpen(false);
      setSelectedDefect(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Downtime Mutations
  const saveDowntimeMutation = useMutation({
    mutationFn: async (data: typeof downtimeForm & { id?: string }) => {
      if (data.id) {
        const { error } = await supabase
          .from("downtime_reasons")
          .update({
            code: data.code,
            name: data.name,
            category: data.category || null,
            is_planned: data.is_planned,
            is_active: data.is_active,
          })
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("downtime_reasons").insert({
          code: data.code,
          name: data.name,
          category: data.category || null,
          is_planned: data.is_planned,
          is_active: data.is_active,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["downtime_reasons"] });
      toast.success(selectedDowntime ? "Downtime reason updated" : "Downtime reason created");
      resetDowntimeForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteDowntimeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("downtime_reasons").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["downtime_reasons"] });
      toast.success("Downtime reason deleted");
      setDeleteDialogOpen(false);
      setSelectedDowntime(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const resetDefectForm = () => {
    setDefectForm({ code: "", name: "", severity: "minor", is_active: true });
    setSelectedDefect(null);
    setDialogOpen(false);
  };

  const resetDowntimeForm = () => {
    setDowntimeForm({ code: "", name: "", category: "", is_planned: false, is_active: true });
    setSelectedDowntime(null);
    setDialogOpen(false);
  };

  const handleEditDefect = (item: DefectReason) => {
    setSelectedDefect(item);
    setDefectForm({
      code: item.code,
      name: item.name,
      severity: item.severity || "minor",
      is_active: item.is_active ?? true,
    });
    setDialogOpen(true);
  };

  const handleEditDowntime = (item: DowntimeReason) => {
    setSelectedDowntime(item);
    setDowntimeForm({
      code: item.code,
      name: item.name,
      category: item.category || "",
      is_planned: item.is_planned ?? false,
      is_active: item.is_active ?? true,
    });
    setDialogOpen(true);
  };

  const defectColumns = [
    { key: "code", header: "Code" },
    { key: "name", header: "Name" },
    { key: "severity", header: "Severity" },
    {
      key: "is_active",
      header: "Status",
      render: (item: DefectReason) => (
        <span className={item.is_active ? "text-green-500" : "text-red-500"}>
          {item.is_active ? "Active" : "Inactive"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (item: DefectReason) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => handleEditDefect(item)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setSelectedDefect(item);
              setDeleteDialogOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  const downtimeColumns = [
    { key: "code", header: "Code" },
    { key: "name", header: "Name" },
    { key: "category", header: "Category" },
    {
      key: "is_planned",
      header: "Type",
      render: (item: DowntimeReason) => (
        <span className={item.is_planned ? "text-blue-500" : "text-amber-500"}>
          {item.is_planned ? "Planned" : "Unplanned"}
        </span>
      ),
    },
    {
      key: "is_active",
      header: "Status",
      render: (item: DowntimeReason) => (
        <span className={item.is_active ? "text-green-500" : "text-red-500"}>
          {item.is_active ? "Active" : "Inactive"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (item: DowntimeReason) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => handleEditDowntime(item)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setSelectedDowntime(item);
              setDeleteDialogOpen(true);
            }}
          >
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
          title="Reason Masters"
          description="Manage defect and downtime reasons"
          icon={Database}
          iconColor="bg-amber-500/10 text-amber-500"
          action={{
            label: activeTab === "defect" ? "Add Defect Reason" : "Add Downtime Reason",
            onClick: () => {
              if (activeTab === "defect") resetDefectForm();
              else resetDowntimeForm();
              setDialogOpen(true);
            },
            icon: Plus,
          }}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="defect">Defect Reasons</TabsTrigger>
            <TabsTrigger value="downtime">Downtime Reasons</TabsTrigger>
          </TabsList>

          <TabsContent value="defect" className="mt-4">
            <DataTable
              columns={defectColumns}
              data={defectReasons}
              emptyMessage={loadingDefects ? "Loading..." : "No defect reasons found"}
            />
          </TabsContent>

          <TabsContent value="downtime" className="mt-4">
            <DataTable
              columns={downtimeColumns}
              data={downtimeReasons}
              emptyMessage={loadingDowntime ? "Loading..." : "No downtime reasons found"}
            />
          </TabsContent>
        </Tabs>

        {/* Defect Reason Dialog */}
        <Dialog
          open={dialogOpen && activeTab === "defect"}
          onOpenChange={(open) => {
            if (!open) resetDefectForm();
            else setDialogOpen(open);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {selectedDefect ? "Edit Defect Reason" : "Add Defect Reason"}
              </DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveDefectMutation.mutate({ ...defectForm, id: selectedDefect?.id });
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="code">Code</Label>
                  <Input
                    id="code"
                    value={defectForm.code}
                    onChange={(e) => setDefectForm({ ...defectForm, code: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={defectForm.name}
                    onChange={(e) => setDefectForm({ ...defectForm, name: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="severity">Severity</Label>
                <Select
                  value={defectForm.severity}
                  onValueChange={(value) => setDefectForm({ ...defectForm, severity: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minor">Minor</SelectItem>
                    <SelectItem value="major">Major</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="is_active"
                  checked={defectForm.is_active}
                  onCheckedChange={(checked) => setDefectForm({ ...defectForm, is_active: checked })}
                />
                <Label htmlFor="is_active">Active</Label>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetDefectForm}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saveDefectMutation.isPending}>
                  {saveDefectMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Downtime Reason Dialog */}
        <Dialog
          open={dialogOpen && activeTab === "downtime"}
          onOpenChange={(open) => {
            if (!open) resetDowntimeForm();
            else setDialogOpen(open);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {selectedDowntime ? "Edit Downtime Reason" : "Add Downtime Reason"}
              </DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveDowntimeMutation.mutate({ ...downtimeForm, id: selectedDowntime?.id });
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="dt-code">Code</Label>
                  <Input
                    id="dt-code"
                    value={downtimeForm.code}
                    onChange={(e) => setDowntimeForm({ ...downtimeForm, code: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dt-name">Name</Label>
                  <Input
                    id="dt-name"
                    value={downtimeForm.name}
                    onChange={(e) => setDowntimeForm({ ...downtimeForm, name: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  value={downtimeForm.category}
                  onChange={(e) => setDowntimeForm({ ...downtimeForm, category: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    id="is_planned"
                    checked={downtimeForm.is_planned}
                    onCheckedChange={(checked) =>
                      setDowntimeForm({ ...downtimeForm, is_planned: checked })
                    }
                  />
                  <Label htmlFor="is_planned">Planned Downtime</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="dt_is_active"
                    checked={downtimeForm.is_active}
                    onCheckedChange={(checked) =>
                      setDowntimeForm({ ...downtimeForm, is_active: checked })
                    }
                  />
                  <Label htmlFor="dt_is_active">Active</Label>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetDowntimeForm}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saveDowntimeMutation.isPending}>
                  {saveDowntimeMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete {activeTab === "defect" ? "Defect" : "Downtime"} Reason
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "
                {activeTab === "defect" ? selectedDefect?.name : selectedDowntime?.name}"? This
                action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (activeTab === "defect" && selectedDefect) {
                    deleteDefectMutation.mutate(selectedDefect.id);
                  } else if (selectedDowntime) {
                    deleteDowntimeMutation.mutate(selectedDowntime.id);
                  }
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
