import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Coins, Plus, Pencil, Trash2, Info } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
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
import { useAuth } from "@/contexts/AuthContext";

interface Rate {
  id: string;
  product_id: string | null;
  defect_grade_id: string;
  standard_cost: number;
  sale_rate: number;
  is_active: boolean;
  notes: string | null;
}

const empty = {
  product_id: "default", defect_grade_id: "", standard_cost: "", sale_rate: "",
  notes: "", is_active: true,
};

const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function RWDefectRatesPage() {
  const qc = useQueryClient();
  const { hasModulePermission, hasRole } = useAuth();
  const canEdit = hasRole("super_admin") || hasModulePermission("rejections_wastages", "edit");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Rate | null>(null);
  const [form, setForm] = useState(empty);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["rw-defect-rates"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("rw_defect_rates").select("*");
      if (error) throw error;
      return data as Rate[];
    },
  });

  const { data: grades = [] } = useQuery({
    queryKey: ["rw-rate-grades"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("rw_defect_grades").select("id, code, name").eq("is_active", true).order("sort_order");
      return (data || []) as { id: string; code: string; name: string }[];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["rw-rate-products"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products").select("id, code, name").eq("is_active", true).order("name");
      return (data || []) as { id: string; code: string; name: string }[];
    },
  });

  const gradeMap = useMemo(() => Object.fromEntries(grades.map((g) => [g.id, g])), [grades]);
  const productMap = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const g = (gradeMap[a.defect_grade_id]?.name ?? "").localeCompare(
          gradeMap[b.defect_grade_id]?.name ?? "",
        );
        if (g) return g;
        if (!a.product_id) return -1;
        if (!b.product_id) return 1;
        return (productMap[a.product_id]?.code ?? "").localeCompare(productMap[b.product_id]?.code ?? "");
      }),
    [rows, gradeMap, productMap],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!form.defect_grade_id) throw new Error("Pick a defect grade");
      const payload = {
        product_id: form.product_id !== "default" ? form.product_id : null,
        defect_grade_id: form.defect_grade_id,
        standard_cost: parseFloat(form.standard_cost) || 0,
        sale_rate: parseFloat(form.sale_rate) || 0,
        notes: form.notes.trim() || null,
        is_active: form.is_active,
      };
      const q = editing
        ? (supabase as any).from("rw_defect_rates").update(payload).eq("id", editing.id)
        : (supabase as any).from("rw_defect_rates").insert(payload);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editing ? "Rate updated" : "Rate added");
      qc.invalidateQueries({ queryKey: ["rw-defect-rates"] });
      setOpen(false); setEditing(null); setForm(empty);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("rw_defect_rates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["rw-defect-rates"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const startEdit = (r: Rate) => {
    setEditing(r);
    setForm({
      product_id: r.product_id ?? "default",
      defect_grade_id: r.defect_grade_id,
      standard_cost: String(r.standard_cost ?? ""),
      sale_rate: String(r.sale_rate ?? ""),
      notes: r.notes ?? "",
      is_active: r.is_active,
    });
    setOpen(true);
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Cheap Ball Rates"
          description="Book value and expected realisation per model and defect grade"
          icon={Coins}
          iconColor="bg-emerald-600 text-white"
        >
          {canEdit && (
            <Button onClick={() => { setEditing(null); setForm(empty); setOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Add rate
            </Button>
          )}
        </PageHeader>

        <div className="flex items-start gap-2 rounded-lg bg-sky-500/[0.06] ring-1 ring-inset ring-sky-500/20 px-3 py-2 text-[12.5px] text-sky-900 dark:text-sky-200">
          <Info className="h-4 w-4 text-sky-500 shrink-0 mt-0.5" />
          <span>
            An exact model rate wins; otherwise the grade's default row applies. The cost is copied
            onto each ledger movement when it posts, so changing a rate never rewrites past value.
          </span>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading</div>
            ) : !sorted.length ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No rates yet — counts will post at zero value until one is set.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Defect grade</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead className="text-right">Standard cost</TableHead>
                      <TableHead className="text-right">Sale rate</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead>Active</TableHead>
                      {canEdit && <TableHead className="w-24"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {gradeMap[r.defect_grade_id]?.name ?? "—"}
                        </TableCell>
                        <TableCell>
                          {r.product_id ? (
                            <span className="font-display font-bold">
                              {productMap[r.product_id]?.code ?? "—"}
                            </span>
                          ) : (
                            <Badge variant="secondary">Default for the grade</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(r.standard_cost)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(r.sale_rate)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.notes ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant={r.is_active ? "success" : "secondary"}>
                            {r.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        {canEdit && (
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(r)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                                onClick={() => { if (confirm("Delete this rate?")) remove.mutate(r.id); }}
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
            )}
          </CardContent>
        </Card>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit rate" : "Add rate"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label className="text-xs">Defect grade</Label>
                <Select value={form.defect_grade_id} onValueChange={(v) => setForm({ ...form, defect_grade_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Pick a grade" /></SelectTrigger>
                  <SelectContent>
                    {grades.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Model</Label>
                <Select value={form.product_id} onValueChange={(v) => setForm({ ...form, product_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default for the grade</SelectItem>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Standard cost</Label>
                  <Input
                    inputMode="decimal" value={form.standard_cost}
                    onChange={(e) => setForm({ ...form, standard_cost: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Sale rate</Label>
                  <Input
                    inputMode="decimal" value={form.sale_rate}
                    onChange={(e) => setForm({ ...form, sale_rate: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                <Label className="text-sm">Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
