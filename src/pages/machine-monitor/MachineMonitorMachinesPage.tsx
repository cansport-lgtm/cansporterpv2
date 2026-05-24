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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Monitor, Plus, X, Pencil, Trash2, QrCode, Printer } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  splitReasonGroups,
  joinReasonGroups,
  DEFAULT_BREAKDOWN_REASONS,
  DEFAULT_PERFORMANCE_REASONS,
  parseStatus,
  statusColorClass,
} from "./statusUtils";

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
    breakdown_reasons: [...DEFAULT_BREAKDOWN_REASONS],
    performance_issue_reasons: [...DEFAULT_PERFORMANCE_REASONS],
    is_active: true,
  });
  const [newBreakdownReason, setNewBreakdownReason] = useState("");
  const [newPerfReason, setNewPerfReason] = useState("");

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

  const { data: departments = [] } = useQuery({
    queryKey: ["production-departments-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as { id: string; name: string; code: string }[];
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
        custom_statuses: joinReasonGroups(values.breakdown_reasons, values.performance_issue_reasons),
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
    setForm({
      name: "",
      code: "",
      department: "",
      location: "",
      sort_order: 0,
      breakdown_reasons: [...DEFAULT_BREAKDOWN_REASONS],
      performance_issue_reasons: [...DEFAULT_PERFORMANCE_REASONS],
      is_active: true,
    });
    setDialogOpen(true);
  };

  const openEdit = (m: Machine) => {
    setEditing(m);
    const groups = splitReasonGroups(m.custom_statuses);
    setForm({
      name: m.name,
      code: m.code,
      department: m.department || "",
      location: m.location || "",
      sort_order: m.sort_order,
      breakdown_reasons: groups.breakdown_reasons,
      performance_issue_reasons: groups.performance_issue_reasons,
      is_active: m.is_active,
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setNewBreakdownReason("");
    setNewPerfReason("");
  };

  const addBreakdownReason = () => {
    const t = newBreakdownReason.trim();
    if (t && !form.breakdown_reasons.includes(t)) {
      setForm({ ...form, breakdown_reasons: [...form.breakdown_reasons, t] });
    }
    setNewBreakdownReason("");
  };
  const removeBreakdownReason = (s: string) => {
    setForm({ ...form, breakdown_reasons: form.breakdown_reasons.filter((x) => x !== s) });
  };
  const addPerfReason = () => {
    const t = newPerfReason.trim();
    if (t && !form.performance_issue_reasons.includes(t)) {
      setForm({ ...form, performance_issue_reasons: [...form.performance_issue_reasons, t] });
    }
    setNewPerfReason("");
  };
  const removePerfReason = (s: string) => {
    setForm({ ...form, performance_issue_reasons: form.performance_issue_reasons.filter((x) => x !== s) });
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
      render: (row: Machine) => (
        <Badge className={`${statusColorClass(row.current_status)} border`}>
          {row.current_status}
        </Badge>
      ),
    },
    {
      key: "custom_statuses",
      header: "Reason Add-ons",
      render: (row: Machine) => {
        const g = splitReasonGroups(row.custom_statuses);
        return (
          <div className="flex flex-wrap gap-1 max-w-[260px]">
            <Badge variant="outline" className="text-[10px] bg-red-50 border-red-200 text-red-700">
              Breakdown: {g.breakdown_reasons.length}
            </Badge>
            <Badge variant="outline" className="text-[10px] bg-yellow-50 border-yellow-200 text-yellow-700">
              Performance: {g.performance_issue_reasons.length}
            </Badge>
          </div>
        );
      },
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
                <Select
                  value={form.department || "none"}
                  onValueChange={(v) => setForm({ ...form, department: v === "none" ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

            {/* Breakdown reasons */}
            <div>
              <Label className="text-red-700">Breakdown Reasons</Label>
              <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
                {form.breakdown_reasons.map((s) => (
                  <Badge key={s} variant="secondary" className="gap-1 pr-1 bg-red-50 text-red-700 border border-red-200">
                    {s}
                    <button onClick={() => removeBreakdownReason(s)} className="ml-1 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {form.breakdown_reasons.length === 0 && (
                  <span className="text-xs text-muted-foreground">No breakdown reasons added.</span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newBreakdownReason}
                  onChange={(e) => setNewBreakdownReason(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addBreakdownReason())}
                  placeholder="e.g. Wire Break, Motor Failure..."
                  className="flex-1"
                />
                <Button type="button" size="sm" variant="outline" onClick={addBreakdownReason}>Add</Button>
              </div>
            </div>

            {/* Performance Issue reasons */}
            <div>
              <Label className="text-yellow-700">Performance Issue Reasons</Label>
              <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
                {form.performance_issue_reasons.map((s) => (
                  <Badge key={s} variant="secondary" className="gap-1 pr-1 bg-yellow-50 text-yellow-700 border border-yellow-200">
                    {s}
                    <button onClick={() => removePerfReason(s)} className="ml-1 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {form.performance_issue_reasons.length === 0 && (
                  <span className="text-xs text-muted-foreground">No performance issue reasons added.</span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newPerfReason}
                  onChange={(e) => setNewPerfReason(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPerfReason())}
                  placeholder="e.g. Cooling Delay, Slow Speed..."
                  className="flex-1"
                />
                <Button type="button" size="sm" variant="outline" onClick={addPerfReason}>Add</Button>
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