import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal, Plus, Pencil, Trash2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  QsParameter, round2, useQsParameters, useQsSettings,
} from "@/components/quality-score/qsShared";

const emptyForm = {
  scope: "ball" as "ball" | "process",
  name: "",
  description: "",
  weight: 0,
  sort_order: 0,
  is_active: true,
};

// Weight changes apply to NEW score entries only — every submitted score snapshots the
// parameter name + weight it was scored against, so history never rewrites itself.
export default function QSParametersMasterPage() {
  const qc = useQueryClient();
  const { hasRole, hasModulePermission } = useAuth();
  const canManage = hasRole("super_admin") || hasModulePermission("quality_score", "approve");

  const { data: parameters = [], isLoading } = useQsParameters();
  const { data: settings } = useQsSettings();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<QsParameter | null>(null);
  const [form, setForm] = useState(emptyForm);

  const [ballWeight, setBallWeight] = useState("50");
  const [processMode, setProcessMode] = useState("parameters");
  const [threshold, setThreshold] = useState("1.5");
  useEffect(() => {
    if (settings) {
      setBallWeight(String(round2(Number(settings.ball_weight))));
      setProcessMode(settings.process_mode);
      setThreshold(String(round2(Number(settings.disagreement_threshold))));
    }
  }, [settings]);

  const saveParam = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name is required");
      const weight = Number(form.weight);
      if (Number.isNaN(weight) || weight < 0 || weight > 100) {
        throw new Error("Weightage must be between 0 and 100");
      }
      const payload = {
        scope: form.scope,
        name: form.name.trim(),
        description: form.description.trim() || null,
        weight,
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
        updated_at: new Date().toISOString(),
      };
      const q = editing
        ? (supabase as any).from("qs_parameters").update(payload).eq("id", editing.id)
        : (supabase as any).from("qs_parameters").insert(payload);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editing ? "Parameter updated" : "Parameter added");
      qc.invalidateQueries({ queryKey: ["qs-parameters"] });
      setOpen(false); setEditing(null); setForm(emptyForm);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeParam = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("qs_parameters").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Parameter deleted");
      qc.invalidateQueries({ queryKey: ["qs-parameters"] });
    },
    onError: () =>
      toast.error("Cannot delete a parameter that already has scores — deactivate it instead"),
  });

  const saveSettings = useMutation({
    mutationFn: async () => {
      const bw = Number(ballWeight);
      if (Number.isNaN(bw) || bw < 0 || bw > 100) {
        throw new Error("Ball weight must be between 0 and 100");
      }
      const th = Number(threshold);
      if (Number.isNaN(th) || th < 0) throw new Error("Threshold must be 0 or more");
      const { error } = await (supabase as any).from("qs_settings").update({
        ball_weight: bw,
        process_weight: round2(100 - bw),
        process_mode: processMode,
        disagreement_threshold: th,
        updated_at: new Date().toISOString(),
      }).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["qs-settings"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const startAdd = (scope: "ball" | "process") => {
    setEditing(null);
    setForm({ ...emptyForm, scope });
    setOpen(true);
  };
  const startEdit = (p: QsParameter) => {
    setEditing(p);
    setForm({
      scope: p.scope, name: p.name, description: p.description ?? "",
      weight: Number(p.weight), sort_order: p.sort_order, is_active: p.is_active,
    });
    setOpen(true);
  };

  const renderScope = (scope: "ball" | "process", title: string, note: string) => {
    const rows = parameters.filter((p) => p.scope === scope);
    const total = round2(rows.filter((p) => p.is_active).reduce((s, p) => s + Number(p.weight), 0));
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="font-display text-base font-bold">{title}</h3>
              <Badge variant={total === 100 ? "success" : "destructive"}>
                Weightage total {total}%
              </Badge>
            </div>
            {canManage && (
              <Button variant="outline" size="sm" onClick={() => startAdd(scope)}>
                <Plus className="mr-2 h-4 w-4" /> Add Parameter
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parameter</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Weightage</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead className="w-24"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="max-w-md text-sm text-muted-foreground">
                      {p.description ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-display font-bold">
                      {round2(Number(p.weight))}%
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.is_active ? "success" : "secondary"}>
                        {p.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(p)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                            onClick={() => { if (confirm(`Delete ${p.name}?`)) removeParam.mutate(p.id); }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="border-t pt-3 text-xs text-muted-foreground">{note}</p>
        </CardContent>
      </Card>
    );
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-5xl space-y-4">
        <PageHeader
          title="Quality Score — Parameters Master"
          description="Configure the parameters and weightages used for Ball and Process Quality scoring"
          icon={SlidersHorizontal}
        />

        {!canManage && (
          <Card>
            <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <ShieldAlert className="h-4 w-4" /> View only — a Quality Score manager or super admin maintains this master.
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading</div>
        ) : (
          <>
            {renderScope(
              "ball",
              "Ball Quality Parameters",
              "Active weightages must total exactly 100%. Changes apply to new entries only — submitted scores keep the weights they were entered with.",
            )}
            {renderScope(
              "process",
              "Process Quality Parameters",
              "Used only in parameter-based mode (see Module Settings below). In holistic mode inspectors give one overall score out of 10 and this list is ignored.",
            )}

            <Card>
              <CardContent className="space-y-4 p-6">
                <h3 className="font-display text-base font-bold">Module Settings</h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <Label className="text-xs">Ball Quality weight in Overall (%)</Label>
                    <Input
                      type="number" min={0} max={100} value={ballWeight}
                      disabled={!canManage}
                      onChange={(e) => setBallWeight(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Process Quality weight in Overall (%)</Label>
                    <Input value={String(round2(100 - (Number(ballWeight) || 0)))} disabled />
                  </div>
                  <div>
                    <Label className="text-xs">Process Quality mode</Label>
                    <Select value={processMode} onValueChange={setProcessMode} disabled={!canManage}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="parameters">Parameter-based</SelectItem>
                        <SelectItem value="holistic">Single holistic score</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Disagreement flag threshold (Δ)</Label>
                    <Input
                      type="number" min={0} step={0.1} value={threshold}
                      disabled={!canManage}
                      onChange={(e) => setThreshold(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Overall Quality Score = Ball average × {ballWeight || 0}% + Process average × {round2(100 - (Number(ballWeight) || 0))}%.
                  Inspector counts: {settings?.ball_inspector_count ?? 3} for Ball, {settings?.process_inspector_count ?? 2} for Process.
                </p>
                {canManage && (
                  <div className="flex justify-end">
                    <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
                      Save Settings
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editing ? "Edit parameter" : "Add parameter"} — {form.scope === "ball" ? "Ball Quality" : "Process Quality"}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Weightage (%)</Label>
                  <Input
                    type="number" min={0} max={100} value={form.weight}
                    onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Sort order</Label>
                  <Input
                    type="number" value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                <Label className="text-sm">Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => saveParam.mutate()} disabled={saveParam.isPending}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
