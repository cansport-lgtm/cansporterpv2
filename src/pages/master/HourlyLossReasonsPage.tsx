import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface LossReason {
  id: string;
  code: string;
  name: string;
  category: string | null;
  is_active: boolean;
}

interface ReasonProcess {
  id: string;
  reason_id: string;
  process_name: string;
}

export default function HourlyLossReasonsPage() {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState<LossReason | null>(null);
  const [toDelete, setToDelete] = useState<LossReason | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    code: "",
    name: "",
    category: "",
    is_active: true,
  });
  const [selectedProcesses, setSelectedProcesses] = useState<string[]>([]);

  const { data: reasons = [] } = useQuery({
    queryKey: ["hourly-loss-reasons"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hourly_loss_reasons")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data || []) as LossReason[];
    },
  });

  const { data: links = [] } = useQuery({
    queryKey: ["hourly-loss-reason-processes"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hourly_loss_reason_processes")
        .select("*");
      if (error) throw error;
      return (data || []) as ReasonProcess[];
    },
  });

  const { data: processes = [] } = useQuery({
    queryKey: ["qa-processes-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("qa_processes")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as { id: string; name: string }[];
    },
  });

  const linksByReason = useMemo(() => {
    const map: Record<string, string[]> = {};
    links.forEach((l) => {
      if (!map[l.reason_id]) map[l.reason_id] = [];
      map[l.reason_id].push(l.process_name);
    });
    return map;
  }, [links]);

  const resetForm = () => {
    setDialogOpen(false);
    setEditing(null);
    setForm({ code: "", name: "", category: "", is_active: true });
    setSelectedProcesses([]);
  };

  const handleEdit = (r: LossReason) => {
    setEditing(r);
    setForm({
      code: r.code,
      name: r.name,
      category: r.category || "",
      is_active: r.is_active,
    });
    setSelectedProcesses(linksByReason[r.id] || []);
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        category: form.category.trim() || null,
        is_active: form.is_active,
      };
      let reasonId = editing?.id;
      if (editing) {
        const { error } = await (supabase as any)
          .from("hourly_loss_reasons")
          .update(payload)
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { data, error } = await (supabase as any)
          .from("hourly_loss_reasons")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        reasonId = data.id;
      }

      // Replace process links
      await (supabase as any)
        .from("hourly_loss_reason_processes")
        .delete()
        .eq("reason_id", reasonId);

      if (selectedProcesses.length > 0) {
        const inserts = selectedProcesses.map((p) => ({
          reason_id: reasonId,
          process_name: p,
        }));
        const { error } = await (supabase as any)
          .from("hourly_loss_reason_processes")
          .insert(inserts);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hourly-loss-reasons"] });
      qc.invalidateQueries({ queryKey: ["hourly-loss-reason-processes"] });
      toast.success(editing ? "Reason updated" : "Reason added");
      resetForm();
    },
    onError: (e: any) => toast.error(e.message || "Failed to save"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data: used } = await (supabase as any)
        .from("hourly_production_losses")
        .select("id")
        .eq("loss_reason_id", id)
        .limit(1);
      if (used && used.length > 0) {
        throw new Error(
          "Cannot delete a reason that has loss entries. Deactivate it instead.",
        );
      }
      const { error } = await (supabase as any)
        .from("hourly_loss_reasons")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hourly-loss-reasons"] });
      toast.success("Reason deleted");
      setDeleteOpen(false);
      setToDelete(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleProcess = (name: string) => {
    setSelectedProcesses((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name],
    );
  };

  const filtered = reasons.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.code.toLowerCase().includes(search.toLowerCase()) ||
      (r.category || "").toLowerCase().includes(search.toLowerCase()),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code || !form.name) {
      toast.error("Code and Name are required");
      return;
    }
    saveMutation.mutate();
  };

  const columns = [
    {
      key: "code",
      header: "Code",
      render: (i: LossReason) => <span className="font-medium">{i.code}</span>,
    },
    { key: "name", header: "Name" },
    {
      key: "category",
      header: "Category",
      render: (i: LossReason) => i.category || "—",
    },
    {
      key: "processes",
      header: "Applicable Processes",
      render: (i: LossReason) => {
        const list = linksByReason[i.id] || [];
        if (list.length === 0)
          return (
            <Badge variant="outline" className="text-xs">
              All processes
            </Badge>
          );
        return (
          <div className="flex flex-wrap gap-1 max-w-md">
            {list.map((p) => (
              <Badge key={p} variant="secondary" className="text-xs">
                {p}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      key: "is_active",
      header: "Status",
      render: (i: LossReason) => (
        <Badge variant={i.is_active ? "default" : "secondary"}>
          {i.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (i: LossReason) => (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleEdit(i)}
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          {isSuperAdmin && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setToDelete(i);
                setDeleteOpen(true);
              }}
              title="Delete"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Hourly Loss Reasons"
        description="Manage reasons for hourly production losses, mapped per process"
        icon={AlertTriangle}
        iconColor="bg-amber-600 text-white"
        action={{
          label: "Add Reason",
          onClick: () => setDialogOpen(true),
          icon: Plus,
        }}
      />

      <div className="flex flex-wrap gap-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search reasons..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 w-[260px]"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        emptyMessage="No reasons configured yet"
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => (o ? setDialogOpen(true) : resetForm())}>
        <DialogContent className="max-w-lg max-h-[90vh] w-[95vw] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Loss Reason" : "Add Loss Reason"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col">
            <ScrollArea className="flex-1 pr-3">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Code *</Label>
                    <Input
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value })}
                      placeholder="e.g., MCH_BD"
                      required
                    />
                  </div>
                  <div>
                    <Label>Category</Label>
                    <Input
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                      placeholder="e.g., Machine"
                    />
                  </div>
                </div>
                <div>
                  <Label>Name *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g., Machine Breakdown"
                    required
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={form.is_active}
                    onCheckedChange={(c) => setForm({ ...form, is_active: c })}
                  />
                  <Label>Active</Label>
                </div>
                <div>
                  <Label className="mb-2 block">
                    Applicable Processes
                    <span className="text-xs text-muted-foreground font-normal ml-2">
                      (leave empty to apply to all processes)
                    </span>
                  </Label>
                  <div className="border rounded-md p-3 max-h-64 overflow-y-auto space-y-2 bg-muted/20">
                    {processes.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No processes available
                      </p>
                    ) : (
                      processes.map((p) => (
                        <div key={p.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`p-${p.id}`}
                            checked={selectedProcesses.includes(p.name)}
                            onCheckedChange={() => toggleProcess(p.name)}
                          />
                          <label
                            htmlFor={`p-${p.id}`}
                            className="text-sm cursor-pointer flex-1"
                          >
                            {p.name}
                          </label>
                        </div>
                      ))
                    )}
                  </div>
                  {selectedProcesses.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {selectedProcesses.length} process(es) selected
                    </p>
                  )}
                </div>
              </div>
            </ScrollArea>
            <DialogFooter className="mt-4">
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

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete reason</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{toDelete?.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toDelete && deleteMutation.mutate(toDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
