import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ClipboardList } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { SearchableSelect } from "@/components/shared/SearchableSelect";

const sb = supabase as any;

type ParamType = "numeric" | "text" | "boolean" | "select";

const PARAM_TYPES: { value: ParamType; label: string }[] = [
  { value: "numeric", label: "Numeric (range)" },
  { value: "text", label: "Text (expected value)" },
  { value: "boolean", label: "Yes / No" },
  { value: "select", label: "Choice list" },
];

interface ParamForm {
  id?: string;
  parameter_name: string;
  parameter_name_ur: string;
  parameter_type: ParamType;
  unit: string;
  min_value: string;
  max_value: string;
  expected_value: string;
  options: string; // comma-separated for the select type
  is_required: boolean;
  sequence_order: string;
}

const emptyForm = (order: number): ParamForm => ({
  parameter_name: "",
  parameter_name_ur: "",
  parameter_type: "numeric",
  unit: "",
  min_value: "",
  max_value: "",
  expected_value: "",
  options: "",
  is_required: true,
  sequence_order: String(order),
});

// Human-readable spec summary for the list.
function specSummary(p: any): string {
  switch (p.parameter_type) {
    case "numeric": {
      const u = p.unit ? ` ${p.unit}` : "";
      if (p.min_value != null && p.max_value != null) return `${p.min_value} – ${p.max_value}${u}`;
      if (p.min_value != null) return `≥ ${p.min_value}${u}`;
      if (p.max_value != null) return `≤ ${p.max_value}${u}`;
      return "any";
    }
    case "boolean":
      return `expected: ${p.expected_value === "false" ? "No" : "Yes"}`;
    case "select":
      return Array.isArray(p.options) ? p.options.join(" / ") : "—";
    case "text":
      return p.expected_value ? `expected: ${p.expected_value}` : "free text";
    default:
      return "—";
  }
}

export default function QCParametersPage() {
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  // Defining specs is an admin/manager job — the QC inspector only records against them.
  const canManage = hasRole("super_admin") || hasRole("purchase_manager");

  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ParamForm>(emptyForm(1));

  // Raw-material items
  const { data: items } = useQuery({
    queryKey: ["raw-material-items"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("items")
        .select("id, code, name")
        .eq("category", "raw_material")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  // Parameters for the selected item
  const { data: params, isLoading } = useQuery({
    queryKey: ["rm-qc-parameters", selectedItemId],
    queryFn: async () => {
      if (!selectedItemId) return [];
      const { data, error } = await sb
        .from("raw_material_qc_parameters")
        .select("*")
        .eq("item_id", selectedItemId)
        .eq("is_active", true)
        .order("sequence_order");
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedItemId,
  });

  const openNew = () => {
    setForm(emptyForm((params?.length || 0) + 1));
    setDialogOpen(true);
  };

  const openEdit = (p: any) => {
    setForm({
      id: p.id,
      parameter_name: p.parameter_name || "",
      parameter_name_ur: p.parameter_name_ur || "",
      parameter_type: (p.parameter_type || "numeric") as ParamType,
      unit: p.unit || "",
      min_value: p.min_value != null ? String(p.min_value) : "",
      max_value: p.max_value != null ? String(p.max_value) : "",
      expected_value: p.expected_value || "",
      options: Array.isArray(p.options) ? p.options.join(", ") : "",
      is_required: p.is_required ?? true,
      sequence_order: String(p.sequence_order ?? 1),
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (f: ParamForm) => {
      if (!f.parameter_name.trim()) throw new Error("Parameter name is required");
      if (f.parameter_type === "numeric" && f.min_value && f.max_value &&
          parseFloat(f.min_value) > parseFloat(f.max_value)) {
        throw new Error("Min value cannot be greater than max value");
      }
      const options =
        f.parameter_type === "select"
          ? f.options.split(",").map((o) => o.trim()).filter(Boolean)
          : null;

      const payload = {
        item_id: selectedItemId,
        parameter_name: f.parameter_name.trim(),
        parameter_name_ur: f.parameter_name_ur.trim() || null,
        parameter_type: f.parameter_type,
        unit: f.unit.trim() || null,
        min_value: f.parameter_type === "numeric" && f.min_value !== "" ? parseFloat(f.min_value) : null,
        max_value: f.parameter_type === "numeric" && f.max_value !== "" ? parseFloat(f.max_value) : null,
        expected_value:
          f.parameter_type === "text" || f.parameter_type === "boolean"
            ? (f.expected_value.trim() || null)
            : null,
        options,
        is_required: f.is_required,
        sequence_order: parseInt(f.sequence_order) || 1,
      };

      if (f.id) {
        const { error } = await sb.from("raw_material_qc_parameters").update(payload).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("raw_material_qc_parameters").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rm-qc-parameters", selectedItemId] });
      toast.success("Checkpoint saved");
      setDialogOpen(false);
    },
    onError: (e: any) => toast.error(e.message || "Failed to save checkpoint"),
  });

  // Soft-delete so existing inspection readings (which snapshot the spec) stay intact.
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("raw_material_qc_parameters").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rm-qc-parameters", selectedItemId] });
      toast.success("Checkpoint removed");
    },
    onError: (e: any) => toast.error(e.message || "Failed to remove checkpoint"),
  });

  return (
    <ERPLayout>
      <PageHeader
        title="Raw Material QC Checkpoints"
        description="Define the quality checkpoints inspectors check each raw material against"
      >
        {canManage && selectedItemId && (
          <Button onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" /> Add Checkpoint
          </Button>
        )}
      </PageHeader>

      <div className="max-w-md mb-6">
        <Label className="mb-2 block">Raw Material</Label>
        <SearchableSelect
          value={selectedItemId}
          onValueChange={setSelectedItemId}
          placeholder="Select a raw material"
          options={(items || []).map((i: any) => ({
            value: i.id,
            label: i.name,
            secondary: `(${i.code})`,
            search: i.code,
          }))}
        />
      </div>

      {!selectedItemId ? (
        <div className="rounded-lg border bg-card py-12 text-center text-sm text-muted-foreground">
          <ClipboardList className="mx-auto mb-2 h-8 w-8 opacity-40" />
          Select a raw material to view and manage its quality checkpoints.
        </div>
      ) : isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (params || []).length === 0 ? (
        <div className="rounded-lg border bg-card py-12 text-center text-sm text-muted-foreground">
          No checkpoints defined for this raw material yet.
          {canManage && " Use “Add Checkpoint” to create the first one."}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Checkpoint</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Spec</TableHead>
              <TableHead>Required</TableHead>
              {canManage && <TableHead className="w-24 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(params || []).map((p: any) => (
              <TableRow key={p.id}>
                <TableCell>{p.sequence_order}</TableCell>
                <TableCell className="font-medium">
                  {p.parameter_name}
                  {p.parameter_name_ur && (
                    <div className="text-sm text-muted-foreground font-normal" dir="rtl" lang="ur">
                      {p.parameter_name_ur}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {PARAM_TYPES.find((t) => t.value === p.parameter_type)?.label || p.parameter_type}
                  </Badge>
                </TableCell>
                <TableCell>{specSummary(p)}</TableCell>
                <TableCell>
                  {p.is_required
                    ? <Badge className="bg-amber-500">required</Badge>
                    : <span className="text-muted-foreground text-xs">optional</span>}
                </TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(p.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit Checkpoint" : "Add Checkpoint"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Checkpoint Name (English) *</Label>
                <Input
                  value={form.parameter_name}
                  onChange={(e) => setForm({ ...form, parameter_name: e.target.value })}
                  placeholder="e.g. Moisture, Melt Flow Index, Color"
                />
              </div>
              <div className="space-y-2">
                <Label>Checkpoint Name (Urdu)</Label>
                <Input
                  dir="rtl"
                  lang="ur"
                  value={form.parameter_name_ur}
                  onChange={(e) => setForm({ ...form, parameter_name_ur: e.target.value })}
                  placeholder="مثلاً نمی، رنگ"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type *</Label>
                <Select
                  value={form.parameter_type}
                  onValueChange={(v) => setForm({ ...form, parameter_type: v as ParamType })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PARAM_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Order</Label>
                <Input
                  type="number"
                  value={form.sequence_order}
                  onChange={(e) => setForm({ ...form, sequence_order: e.target.value })}
                />
              </div>
            </div>

            {form.parameter_type === "numeric" && (
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Min</Label>
                  <Input type="number" step="any" value={form.min_value}
                    onChange={(e) => setForm({ ...form, min_value: e.target.value })} placeholder="(none)" />
                </div>
                <div className="space-y-2">
                  <Label>Max</Label>
                  <Input type="number" step="any" value={form.max_value}
                    onChange={(e) => setForm({ ...form, max_value: e.target.value })} placeholder="(none)" />
                </div>
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Input value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="%, g/10min" />
                </div>
              </div>
            )}

            {form.parameter_type === "text" && (
              <div className="space-y-2">
                <Label>Expected Value (optional)</Label>
                <Input value={form.expected_value}
                  onChange={(e) => setForm({ ...form, expected_value: e.target.value })}
                  placeholder="Leave blank for free text; a value here is matched exactly" />
              </div>
            )}

            {form.parameter_type === "boolean" && (
              <div className="space-y-2">
                <Label>Expected Answer</Label>
                <Select
                  value={form.expected_value === "false" ? "false" : "true"}
                  onValueChange={(v) => setForm({ ...form, expected_value: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Yes</SelectItem>
                    <SelectItem value="false">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {form.parameter_type === "select" && (
              <div className="space-y-2">
                <Label>Choices (comma-separated)</Label>
                <Input value={form.options}
                  onChange={(e) => setForm({ ...form, options: e.target.value })}
                  placeholder="e.g. Natural, White, Off-white" />
                <p className="text-xs text-muted-foreground">
                  The first choice is treated as the accepted value; others count as out-of-spec.
                </p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Checkbox
                id="is_required"
                checked={form.is_required}
                onCheckedChange={(c) => setForm({ ...form, is_required: !!c })}
              />
              <Label htmlFor="is_required" className="cursor-pointer">Required checkpoint</Label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save Checkpoint"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
