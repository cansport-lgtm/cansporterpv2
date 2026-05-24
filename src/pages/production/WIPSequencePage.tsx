import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowUp, ArrowDown, ListOrdered, Save } from "lucide-react";
import { toast } from "sonner";

interface Department {
  id: string;
  code: string;
  name: string;
}

interface SeqRow {
  department_id: string;
  wip_order: number;
  is_included: boolean;
}

interface RowState extends SeqRow {
  name: string;
  code: string;
}

export default function WIPSequencePage() {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<RowState[]>([]);

  const { data: departments = [] } = useQuery({
    queryKey: ["wip-seq-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Department[];
    },
  });

  const { data: sequence = [] } = useQuery({
    queryKey: ["production_wip_sequence"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_wip_sequence" as any)
        .select("*");
      if (error) throw error;
      return (data || []) as unknown as SeqRow[];
    },
  });

  useEffect(() => {
    if (!departments.length) return;
    const seqMap = new Map(sequence.map(s => [s.department_id, s]));
    const merged: RowState[] = departments.map(d => {
      const s = seqMap.get(d.id);
      return {
        department_id: d.id,
        name: d.name,
        code: d.code,
        wip_order: s?.wip_order ?? 0,
        is_included: s?.is_included ?? false,
      };
    });
    // sort: included first by order, then excluded
    merged.sort((a, b) => {
      if (a.is_included && !b.is_included) return -1;
      if (!a.is_included && b.is_included) return 1;
      if (a.is_included) return a.wip_order - b.wip_order;
      return a.name.localeCompare(b.name);
    });
    setRows(merged);
  }, [departments, sequence]);

  const includedRows = useMemo(() => rows.filter(r => r.is_included), [rows]);

  const levels = useMemo(() => {
    const map = new Map<number, RowState[]>();
    for (const r of includedRows) {
      const arr = map.get(r.wip_order) || [];
      arr.push(r);
      map.set(r.wip_order, arr);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [includedRows]);

  const updateRow = (id: string, patch: Partial<RowState>) => {
    setRows(prev => prev.map(r => r.department_id === id ? { ...r, ...patch } : r));
  };

  const move = (idx: number, dir: -1 | 1) => {
    const included = rows.filter(r => r.is_included).sort((a, b) => a.wip_order - b.wip_order);
    const target = idx + dir;
    if (target < 0 || target >= included.length) return;
    const a = included[idx], b = included[target];
    setRows(prev => prev.map(r => {
      if (r.department_id === a.department_id) return { ...r, wip_order: b.wip_order };
      if (r.department_id === b.department_id) return { ...r, wip_order: a.wip_order };
      return r;
    }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Preserve user-entered levels (duplicates allowed for parallel departments)
      const payload = rows.map(r => ({
        department_id: r.department_id,
        wip_order: r.is_included ? (r.wip_order > 0 ? r.wip_order : 1) : 0,
        is_included: r.is_included,
      }));
      const { error } = await supabase
        .from("production_wip_sequence" as any)
        .upsert(payload, { onConflict: "department_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("WIP sequence saved");
      queryClient.invalidateQueries({ queryKey: ["production_wip_sequence"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="WIP Sequence"
          description="Configure the order in which departments form the production WIP chain. Departments sharing the same level are merged into one ledger stage."
          icon={ListOrdered}
          iconColor="bg-blue-500/10 text-blue-500"
          action={{
            label: saveMutation.isPending ? "Saving..." : "Save Sequence",
            onClick: () => saveMutation.mutate(),
            icon: Save,
          }}
        />

        {levels.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground mb-2">Chain preview (departments at the same level are merged)</div>
              <div className="flex flex-wrap items-center gap-2">
                {levels.map(([lvl, deps], i) => (
                  <div key={lvl} className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-md bg-primary/10 text-primary text-sm font-medium">
                      L{lvl}. {deps.map(d => d.name).join(" + ")}
                    </span>
                    {i < levels.length - 1 && <span className="text-muted-foreground">→</span>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Include</TableHead>
                  <TableHead className="w-24">Order</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead className="w-32 text-right">Reorder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const includedSorted = rows.filter(x => x.is_included).sort((a, b) => a.wip_order - b.wip_order);
                  const idx = includedSorted.findIndex(x => x.department_id === r.department_id);
                  return (
                    <TableRow key={r.department_id}>
                      <TableCell>
                        <Switch
                          checked={r.is_included}
                          onCheckedChange={(v) => {
                            const nextOrder = v ? (Math.max(0, ...rows.filter(x => x.is_included).map(x => x.wip_order)) + 1) : 0;
                            updateRow(r.department_id, { is_included: v, wip_order: nextOrder });
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        {r.is_included ? (
                          <Input
                            type="number"
                            min={1}
                            value={r.wip_order}
                            onChange={(e) => updateRow(r.department_id, { wip_order: parseInt(e.target.value) || 0 })}
                            className="w-20"
                          />
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.code}</TableCell>
                      <TableCell className="text-right">
                        {r.is_included && (
                          <div className="inline-flex gap-1">
                            <Button size="icon" variant="ghost" disabled={idx <= 0} onClick={() => move(idx, -1)}>
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" disabled={idx >= includedSorted.length - 1} onClick={() => move(idx, 1)}>
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
