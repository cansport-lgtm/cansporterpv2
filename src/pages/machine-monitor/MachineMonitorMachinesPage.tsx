import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Monitor, Plus, X, Pencil, Trash2, QrCode, Printer } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

interface Machine {
  id: string;
  name: string;
  code: string;
  department: string | null;
  location: string | null;
  custom_statuses: string[];
  current_status: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

const DEFAULT_STATUSES = ["Running", "Stopped", "Idle", "Breakdown"];

export default function MachineMonitorMachinesPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Machine | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Machine | null>(null);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    code: "",
    department: "",
    location: "",
    sort_order: 0,
    custom_statuses: [...DEFAULT_STATUSES],
    is_active: true,
  });
  const [newStatusInput, setNewStatusInput] = useState("");

  const { data: machines = [], isLoading } = useQuery({
    queryKey: ["machine-monitor-machines"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("machine_monitor_machines")
        .select("*")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return data as unknown as Machine[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (values: typeof form & { id?: string }) => {
      const payload = {
        name: values.name,
        code: values.code,
        department: values.department || null,
        location: values.location || null,
        sort_order: values.sort_order,
        custom_statuses: values.custom_statuses,
        is_active: values.is_active,
      };
      if (values.id) {
        const { error } = await supabase
          .from("machine_monitor_machines")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", values.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("machine_monitor_machines")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["machine-monitor-machines"] });
      toast.success(editing ? "Machine updated" : "Machine added");
      closeDialog();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("machine_monitor_machines")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["machine-monitor-machines"] });
      toast.success("Machine deleted");
      setDeleteTarget(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openAdd = () => {
    setEditing(null);
    setForm({ name: "", code: "", department: "", location: "", sort_order: 0, custom_statuses: [...DEFAULT_STATUSES], is_active: true });
    setDialogOpen(true);
  };

  const openEdit = (m: Machine) => {
    setEditing(m);
    setForm({
      name: m.name,
      code: m.code,
      department: m.department || "",
      location: m.location || "",
      sort_order: m.sort_order,
      custom_statuses: m.custom_statuses,
      is_active: m.is_active,
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setNewStatusInput("");
  };

  const addCustomStatus = () => {
    const trimmed = newStatusInput.trim();
    if (trimmed && !form.custom_statuses.includes(trimmed)) {
      setForm({ ...form, custom_statuses: [...form.custom_statuses, trimmed] });
    }
    setNewStatusInput("");
  };

  const removeCustomStatus = (s: string) => {
    if (form.custom_statuses.length <= 1) return;
    setForm({ ...form, custom_statuses: form.custom_statuses.filter((x) => x !== s) });
  };

  const handleSave = () => {
    if (!form.name || !form.code) {
      toast.error("Name and Code are required");
      return;
    }
    saveMutation.mutate(editing ? { ...form, id: editing.id } : form);
  };

  const columns = [
    { key: "code", header: "Code" },
    { key: "name", header: "Name" },
    { key: "department", header: "Department", render: (row: Machine) => row.department || "—" },
    { key: "location", header: "Location", render: (row: Machine) => row.location || "—" },
    {
      key: "current_status",
      header: "Current Status",
      render: (row: Machine) => {
        const colorMap: Record<string, string> = {
          Running: "bg-green-100 text-green-700",
          Stopped: "bg-slate-100 text-slate-600",
          Idle: "bg-yellow-100 text-yellow-700",
          Breakdown: "bg-red-100 text-red-700",
        };
        return (
          <Badge className={colorMap[row.current_status] || "bg-muted text-muted-foreground"}>
            {row.current_status}
          </Badge>
        );
      },
    },
    {
      key: "custom_statuses",
      header: "Statuses",
      render: (row: Machine) => (
        <div className="flex flex-wrap gap-1">
          {row.custom_statuses.map((s) => (
            <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
          ))}
        </div>
      ),
    },
    {
      key: "is_active",
      header: "Active",
      render: (row: Machine) => (
        <Badge className={row.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}>
          {row.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: Machine) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(row)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(row)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const handlePrintQR = () => {
    const printArea = document.getElementById("machine-qr-labels");
    if (!printArea) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>Machine QR Labels</title>
      <style>
        body { margin: 0; padding: 10px; font-family: Arial, sans-serif; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .label { border: 1px solid #ccc; padding: 10px; text-align: center; page-break-inside: avoid; border-radius: 4px; }
        .label .code { font-weight: bold; font-size: 13px; margin-top: 6px; font-family: monospace; }
        .label .name { font-size: 11px; color: #555; margin-top: 2px; }
        .label .dept { font-size: 9px; color: #888; margin-top: 2px; }
        @media print { .grid { gap: 8px; } .label { border: 1px solid #999; } }
      </style></head><body>${printArea.innerHTML}</body></html>
    `);
    win.document.close();
    win.print();
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Machine Master"
        description="Manage machines for status monitoring"
        icon={Monitor}
        iconColor="bg-cyan-600 text-white"
        action={{ label: "Add Machine", onClick: openAdd, icon: Plus }}
      />

      <div className="flex gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={() => setQrDialogOpen(true)} disabled={machines.length === 0}>
          <QrCode className="h-4 w-4 mr-1" /> Print QR Labels
        </Button>
      </div>

      <DataTable
        data={machines}
        columns={columns}
        onRowClick={openEdit}
      />

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Machine" : "Add Machine"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Machine Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Code *</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Department</Label>
                <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
              </div>
              <div>
                <Label>Location</Label>
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Sort Order</Label>
              <Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} />
            </div>

            {/* Custom Statuses */}
            <div>
              <Label>Custom Statuses</Label>
              <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
                {form.custom_statuses.map((s) => (
                  <Badge key={s} variant="secondary" className="gap-1 pr-1">
                    {s}
                    <button onClick={() => removeCustomStatus(s)} className="ml-1 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newStatusInput}
                  onChange={(e) => setNewStatusInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomStatus())}
                  placeholder="Add custom status..."
                  className="flex-1"
                />
                <Button type="button" size="sm" variant="outline" onClick={addCustomStatus}>Add</Button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : editing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Machine</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}" ({deleteTarget?.code})? This will also delete all status logs for this machine.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* QR Labels Dialog */}
      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" /> Machine QR Labels
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div id="machine-qr-labels">
              <div className="grid grid-cols-3 gap-3">
                {machines.filter((m) => m.is_active).map((m) => (
                  <div key={m.id} className="border rounded-md p-3 flex flex-col items-center">
                    <QRCodeSVG
                      value={`${window.location.origin}/machine-monitor/scan?code=${m.code}`}
                      size={80}
                      level="M"
                    />
                    <div className="font-mono font-bold text-sm mt-2">{m.code}</div>
                    <div className="text-xs text-muted-foreground truncate max-w-[150px] text-center">{m.name}</div>
                    {m.department && <div className="text-[10px] text-muted-foreground/70 mt-0.5">{m.department}</div>}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handlePrintQR}>
                <Printer className="h-4 w-4 mr-1" /> Print Labels
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}