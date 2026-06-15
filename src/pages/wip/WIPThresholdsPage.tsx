import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings2, Save } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { fetchStages, fetchThresholds } from "./wipShared";

interface Row { stage_id: string; label: string; sequence_order: number; max_threshold: number; unit: string; notes: string; id?: string; dirty?: boolean; }

const UNITS = ["dozens", "pcs", "bags"];

export default function WIPThresholdsPage() {
  const qc = useQueryClient();
  const { data: stages = [] } = useQuery({ queryKey: ["wip-stages"], queryFn: () => fetchStages(true) });
  const { data: thresholds = [] } = useQuery({ queryKey: ["wip-thresholds"], queryFn: fetchThresholds });

  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const tMap = new Map(thresholds.map(t => [t.stage_id, t]));
    setRows(stages.map(s => {
      const t = tMap.get(s.id);
      return {
        stage_id: s.id,
        label: s.name,
        sequence_order: s.sequence_order,
        max_threshold: t ? Number(t.max_threshold) : 0,
        unit: t?.unit || s.unit || "dozens",
        notes: t?.notes || "",
        id: t?.id,
        dirty: false,
      };
    }));
  }, [stages, thresholds]);

  const update = (stage_id: string, patch: Partial<Row>) => {
    setRows(prev => prev.map(r => r.stage_id === stage_id ? { ...r, ...patch, dirty: true } : r));
  };

  const saveAll = async () => {
    const dirty = rows.filter(r => r.dirty);
    if (dirty.length === 0) { toast({ title: "No changes" }); return; }
    setSaving(true);
    try {
      for (const r of dirty) {
        const payload = { stage_id: r.stage_id, max_threshold: r.max_threshold, unit: r.unit, notes: r.notes || null };
        const { error } = await supabase.from("wip_stage_thresholds" as any).upsert(payload, { onConflict: "stage_id" });
        if (error) throw error;
      }
      toast({ title: "Saved", description: `${dirty.length} threshold(s) updated.` });
      qc.invalidateQueries({ queryKey: ["wip-thresholds"] });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ERPLayout>
      <div className="space-y-4 p-2 sm:p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <PageHeader
            title="WIP Stage Thresholds"
            description="Set the maximum WIP allowed at each stage. Exceeding this triggers a bottleneck alert on the Monitor."
            icon={Settings2}
            iconColor="bg-amber-500/10 text-amber-500"
          />
          <Button onClick={saveAll} disabled={saving || !rows.some(r => r.dirty)}>
            <Save className="h-4 w-4 mr-1" /> Save Changes
          </Button>
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Order</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="w-40">Max Threshold</TableHead>
                  <TableHead className="w-32">Unit</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No active stages. Add stages in <b>WIP Stages</b> first.</TableCell></TableRow>
                ) : rows.map(r => (
                  <TableRow key={r.stage_id} className={r.dirty ? "bg-amber-500/5" : ""}>
                    <TableCell className="font-medium">{r.sequence_order}</TableCell>
                    <TableCell>{r.label}</TableCell>
                    <TableCell>
                      <Input type="number" min={0} value={r.max_threshold}
                        onChange={(e) => update(r.stage_id, { max_threshold: Number(e.target.value) })} />
                    </TableCell>
                    <TableCell>
                      <Select value={r.unit} onValueChange={(v) => update(r.stage_id, { unit: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input value={r.notes} placeholder="Optional"
                        onChange={(e) => update(r.stage_id, { notes: e.target.value })} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
