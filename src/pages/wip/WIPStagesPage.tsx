import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Layers, Plus, Trash2, Save } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { fetchStages, type WIPStage } from "./wipShared";

const UNITS = ["dozens", "pcs", "bags"];

export default function WIPStagesPage() {
  const qc = useQueryClient();
  const { data: stages = [] } = useQuery({ queryKey: ["wip-stages"], queryFn: () => fetchStages(false) });

  const [name, setName] = useState("");
  const [order, setOrder] = useState<number>(stages.length + 1);
  const [unit, setUnit] = useState("dozens");
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await supabase.from("wip_stages" as any).insert({
      name: name.trim(), sequence_order: order, unit, is_active: true,
    });
    setSaving(false);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Stage added" });
    setName(""); setOrder(o => o + 1);
    qc.invalidateQueries({ queryKey: ["wip-stages"] });
  };

  const update = async (s: WIPStage, patch: Partial<WIPStage>) => {
    const { error } = await supabase.from("wip_stages" as any).update(patch).eq("id", s.id);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["wip-stages"] });
  };

  const remove = async (s: WIPStage) => {
    if (!confirm(`Delete stage "${s.name}"? All thresholds and stock entries for this stage will also be removed.`)) return;
    const { error } = await supabase.from("wip_stages" as any).delete().eq("id", s.id);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Stage deleted" });
    qc.invalidateQueries({ queryKey: ["wip-stages"] });
  };

  return (
    <ERPLayout>
      <div className="space-y-4 p-2 sm:p-4">
        <PageHeader
          title="WIP Stages Master"
          description="Define the unique production stages tracked by the WIP Management module."
          icon={Layers}
          iconColor="bg-amber-500/10 text-amber-500"
        />

        <Card>
          <CardContent className="p-3 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium">Stage name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cutting" />
            </div>
            <div>
              <label className="text-xs font-medium">Sequence order</label>
              <Input type="number" min={1} value={order} onChange={(e) => setOrder(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-xs font-medium">Unit</label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={add} disabled={saving}><Plus className="h-4 w-4 mr-1" /> Add Stage</Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Order</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-32">Unit</TableHead>
                  <TableHead className="w-24">Active</TableHead>
                  <TableHead className="w-24 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stages.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No stages yet. Add one above.</TableCell></TableRow>
                ) : stages.map(s => (
                  <StageRow key={s.id} stage={s} onUpdate={update} onRemove={remove} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}

function StageRow({ stage, onUpdate, onRemove }: { stage: WIPStage; onUpdate: (s: WIPStage, p: Partial<WIPStage>) => void; onRemove: (s: WIPStage) => void }) {
  const [name, setName] = useState(stage.name);
  const [order, setOrder] = useState(stage.sequence_order);
  const [unit, setUnit] = useState(stage.unit);
  const dirty = name !== stage.name || order !== stage.sequence_order || unit !== stage.unit;

  return (
    <TableRow className={dirty ? "bg-amber-500/5" : ""}>
      <TableCell><Input type="number" min={1} value={order} onChange={(e) => setOrder(Number(e.target.value))} className="h-8 w-20" /></TableCell>
      <TableCell><Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" /></TableCell>
      <TableCell>
        <Select value={unit} onValueChange={setUnit}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
        </Select>
      </TableCell>
      <TableCell><Switch checked={stage.is_active} onCheckedChange={(v) => onUpdate(stage, { is_active: v })} /></TableCell>
      <TableCell className="text-right">
        <div className="flex gap-1 justify-end">
          {dirty && (
            <Button size="sm" variant="outline" onClick={() => onUpdate(stage, { name, sequence_order: order, unit })}>
              <Save className="h-3 w-3" />
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onRemove(stage)}><Trash2 className="h-3 w-3 text-red-600" /></Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
