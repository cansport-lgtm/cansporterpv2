import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ClipboardList, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { fetchStages, fetchThresholds, fetchEntriesInRange, fmtNum, statusFromUtil } from "./wipShared";

export default function WIPStockEntryPage() {
  const qc = useQueryClient();
  const now = new Date();
  const [date, setDate] = useState(format(now, "yyyy-MM-dd"));
  const [time, setTime] = useState(format(now, "HH:mm"));
  const [stageId, setStageId] = useState<string>("");
  const [qty, setQty] = useState<number>(0);
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterDate, setFilterDate] = useState(format(now, "yyyy-MM-dd"));

  const { data: stages = [] } = useQuery({ queryKey: ["wip-stages"], queryFn: () => fetchStages(true) });
  const { data: thresholds = [] } = useQuery({ queryKey: ["wip-thresholds"], queryFn: fetchThresholds });
  const { data: entries = [] } = useQuery({
    queryKey: ["wip-entries", filterDate],
    queryFn: () => fetchEntriesInRange(filterDate, filterDate),
  });

  const stageMap = useMemo(() => new Map(stages.map(s => [s.id, s])), [stages]);
  const thMap = useMemo(() => new Map(thresholds.map(t => [t.stage_id, t])), [thresholds]);

  const save = async () => {
    if (!stageId) { toast({ title: "Select a stage", variant: "destructive" }); return; }
    if (qty < 0) { toast({ title: "Quantity must be ≥ 0", variant: "destructive" }); return; }
    setSaving(true);
    const stage = stageMap.get(stageId);
    const { error } = await supabase.from("wip_stock_entries" as any).insert({
      stage_id: stageId,
      entry_date: date,
      entry_time: time + ":00",
      quantity: qty,
      unit: stage?.unit || "dozens",
      remarks: remarks.trim() || null,
    });
    setSaving(false);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Entry saved" });
    setQty(0); setRemarks("");
    setTime(format(new Date(), "HH:mm"));
    qc.invalidateQueries({ queryKey: ["wip-entries"] });
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this entry?")) return;
    const { error } = await supabase.from("wip_stock_entries" as any).delete().eq("id", id);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["wip-entries"] });
  };

  return (
    <ERPLayout>
      <div className="space-y-4 p-2 sm:p-4">
        <PageHeader
          title="WIP Stock Level Entry"
          description="Log the current quantity at each stage. Multiple readings per day are allowed; the latest is shown on the Monitor."
          icon={ClipboardList}
          iconColor="bg-amber-500/10 text-amber-500"
        />

        <Card>
          <CardContent className="p-3 grid grid-cols-1 sm:grid-cols-6 gap-2 items-end">
            <div><Label className="text-xs">Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" /></div>
            <div><Label className="text-xs">Time</Label><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-9" /></div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Stage</Label>
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select stage" /></SelectTrigger>
                <SelectContent>
                  {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.sequence_order}. {s.name} ({s.unit})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Quantity</Label><Input type="number" min={0} step="0.01" value={qty} onChange={(e) => setQty(Number(e.target.value))} className="h-9" /></div>
            <Button onClick={save} disabled={saving}><Plus className="h-4 w-4 mr-1" /> Save Entry</Button>
            <div className="sm:col-span-6">
              <Label className="text-xs">Remarks (optional)</Label>
              <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} placeholder="Notes about this reading" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex justify-between items-end mb-3 gap-2 flex-wrap">
              <div>
                <Label className="text-xs">Show entries for date</Label>
                <Input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="h-9 w-[180px]" />
              </div>
              <Badge variant="outline">{entries.length} entries</Badge>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Threshold</TableHead>
                    <TableHead className="text-right">% Util</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Remarks</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No entries on this date.</TableCell></TableRow>
                  ) : entries.map(e => {
                    const stage = stageMap.get(e.stage_id);
                    const th = thMap.get(e.stage_id);
                    const threshold = th ? Number(th.max_threshold) : 0;
                    const util = threshold > 0 ? (Number(e.quantity) / threshold) * 100 : 0;
                    const st = statusFromUtil(util);
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="font-mono text-xs">{e.entry_time?.slice(0, 5)}</TableCell>
                        <TableCell>{stage ? `${stage.sequence_order}. ${stage.name}` : "—"}</TableCell>
                        <TableCell className="text-right font-semibold">{fmtNum(Number(e.quantity))} <span className="text-xs text-muted-foreground">{e.unit}</span></TableCell>
                        <TableCell className="text-right">{th ? fmtNum(threshold) : "—"}</TableCell>
                        <TableCell className="text-right">{th ? `${util.toFixed(0)}%` : "—"}</TableCell>
                        <TableCell>{th ? <Badge variant="outline" className={st.color}>{st.label}</Badge> : <span className="text-xs text-muted-foreground">No threshold</span>}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{e.remarks || "—"}</TableCell>
                        <TableCell><Button size="sm" variant="ghost" onClick={() => remove(e.id)}><Trash2 className="h-3 w-3 text-red-600" /></Button></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
