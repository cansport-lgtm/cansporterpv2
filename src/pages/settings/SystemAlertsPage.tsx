import { useState, useEffect } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, AlertTriangle, Info, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface SystemAlert {
  id: string;
  type: string;
  message: string;
  module: string | null;
  is_active: boolean;
  priority: number;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
}

const MODULES = [
  "Production", "QA", "HR", "Maintenance", "Sales", "Purchase",
  "Inventory", "Finance", "Labour", "Domestic", "Export", "Expenses",
  "Floor Inventory", "Fixed Assets", "Planning", "Consumption",
  "Performance", "Five S", "Online Sales", "Settings",
];

const alertTypeConfig = {
  error: { label: "Error", color: "destructive" as const, icon: XCircle },
  warning: { label: "Warning", color: "secondary" as const, icon: AlertTriangle },
  info: { label: "Info", color: "outline" as const, icon: Info },
};

export default function SystemAlertsPage() {
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAlert, setEditingAlert] = useState<SystemAlert | null>(null);
  const [form, setForm] = useState({
    type: "info",
    message: "",
    module: "",
    priority: 0,
    is_active: true,
    expires_at: "",
  });

  const fetchAlerts = async () => {
    const { data, error } = await supabase
      .from("system_alerts")
      .select("*")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load alerts");
    } else {
      setAlerts((data as any[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAlerts();
  }, []);

  const openAdd = () => {
    setEditingAlert(null);
    setForm({ type: "info", message: "", module: "", priority: 0, is_active: true, expires_at: "" });
    setDialogOpen(true);
  };

  const openEdit = (alert: SystemAlert) => {
    setEditingAlert(alert);
    setForm({
      type: alert.type,
      message: alert.message,
      module: alert.module || "",
      priority: alert.priority,
      is_active: alert.is_active,
      expires_at: alert.expires_at ? alert.expires_at.substring(0, 16) : "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.message.trim()) {
      toast.error("Message is required");
      return;
    }

    const payload: any = {
      type: form.type,
      message: form.message.trim(),
      module: form.module || null,
      priority: form.priority,
      is_active: form.is_active,
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
    };

    if (editingAlert) {
      const { error } = await supabase
        .from("system_alerts")
        .update(payload)
        .eq("id", editingAlert.id);
      if (error) {
        toast.error("Failed to update alert");
        return;
      }
      toast.success("Alert updated");
    } else {
      const { error } = await supabase.from("system_alerts").insert(payload);
      if (error) {
        toast.error("Failed to create alert");
        return;
      }
      toast.success("Alert created");
    }

    setDialogOpen(false);
    fetchAlerts();
  };

  const handleToggle = async (alert: SystemAlert) => {
    const { error } = await supabase
      .from("system_alerts")
      .update({ is_active: !alert.is_active })
      .eq("id", alert.id);
    if (error) {
      toast.error("Failed to toggle alert");
    } else {
      fetchAlerts();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this alert?")) return;
    const { error } = await supabase.from("system_alerts").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete alert");
    } else {
      toast.success("Alert deleted");
      fetchAlerts();
    }
  };

  const getTypeBadge = (type: string) => {
    const config = alertTypeConfig[type as keyof typeof alertTypeConfig] || alertTypeConfig.info;
    const Icon = config.icon;
    return (
      <Badge variant={config.color} className="flex items-center gap-1 w-fit">
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  return (
    <ERPLayout>
      <PageHeader title="System Alerts" description="Manage alerts displayed on the dashboard">
        <Button onClick={openAdd}>
          <Plus className="h-4 w-4 mr-2" />
          Add Alert
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : alerts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No alerts configured
                  </TableCell>
                </TableRow>
              ) : (
                alerts.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell>{getTypeBadge(alert.type)}</TableCell>
                    <TableCell className="max-w-xs truncate">{alert.message}</TableCell>
                    <TableCell>{alert.module || "—"}</TableCell>
                    <TableCell>{alert.priority}</TableCell>
                    <TableCell>
                      {alert.expires_at
                        ? format(new Date(alert.expires_at), "dd MMM yyyy HH:mm")
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      <Switch checked={alert.is_active} onCheckedChange={() => handleToggle(alert)} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(alert)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(alert.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingAlert ? "Edit Alert" : "Add Alert"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Message *</Label>
              <Textarea
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Alert message..."
              />
            </div>
            <div>
              <Label>Module</Label>
              <Select value={form.module} onValueChange={(v) => setForm({ ...form, module: v })}>
                <SelectTrigger><SelectValue placeholder="Select module" /></SelectTrigger>
                <SelectContent>
                  {MODULES.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Input
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label>Expires At</Label>
              <Input
                type="datetime-local"
                value={form.expires_at}
                onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editingAlert ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
