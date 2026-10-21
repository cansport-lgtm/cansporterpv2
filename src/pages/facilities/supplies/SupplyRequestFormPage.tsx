import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, PackagePlus, Plus, Send, Trash2 } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/facilities";
import {
  loadDepartments, loadOfficeItems, loadSupplyRequest, saveSupplyRequest, sortedLines,
} from "@/lib/facilitiesSupplies";

type Line = { key: string; item_id: string; requested_qty: string; remarks: string };
const newLine = (): Line => ({ key: crypto.randomUUID(), item_id: "", requested_qty: "", remarks: "" });

/** Self service: raise or edit a draft supply request from the admin store. */
export default function SupplyRequestFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  const [departmentId, setDepartmentId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [loaded, setLoaded] = useState(!editing);

  const { data: existing } = useQuery({
    queryKey: ["facilities-supply-request", id], enabled: editing, queryFn: () => loadSupplyRequest(id as string),
  });
  useEffect(() => {
    if (!existing || loaded) return;
    setDepartmentId(existing.department_id);
    setReason(existing.reason);
    setLines(sortedLines(existing).map((l) => ({ key: l.id, item_id: l.item_id, requested_qty: String(l.requested_qty), remarks: l.remarks ?? "" })));
    setLoaded(true);
  }, [existing, loaded]);
  useEffect(() => {
    if (!editing && !departmentId && user?.department_id) setDepartmentId(user.department_id);
  }, [editing, departmentId, user?.department_id]);

  const { data: departments = [] } = useQuery({ queryKey: ["production-departments-active"], queryFn: loadDepartments });
  const { data: items = [] } = useQuery({ queryKey: ["facilities-office-items"], queryFn: loadOfficeItems });
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const used = new Set(lines.map((l) => l.item_id).filter(Boolean));

  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = useMutation({
    mutationFn: (submit: boolean) => saveSupplyRequest(id ?? null, {
      department_id: departmentId,
      reason,
      lines: lines.filter((l) => l.item_id || l.requested_qty).map((l) => ({ item_id: l.item_id, requested_qty: Number(l.requested_qty), remarks: l.remarks })),
    }, submit),
    onSuccess: (newId, submit) => {
      toast({ title: submit ? "Supply request submitted" : "Draft saved", description: submit ? "Your department head has been told." : undefined });
      queryClient.invalidateQueries({ queryKey: ["facilities-supply-requests"] });
      queryClient.invalidateQueries({ queryKey: ["facilities-supply-request", newId] });
      navigate(`/my-supply-requests/${newId}`);
    },
    onError: (e) => toast({ title: "Not saved", description: errorMessage(e), variant: "destructive" }),
  });

  const canSave = Boolean(departmentId) && reason.trim().length > 0 && lines.some((l) => l.item_id && Number(l.requested_qty) > 0);

  if (editing && existing && existing.status !== "draft") {
    return (
      <ERPLayout>
        <Card><CardContent className="pt-4">This request has been submitted and can no longer be edited.</CardContent></Card>
      </ERPLayout>
    );
  }

  return (
    <ERPLayout>
      <div className="w-full max-w-4xl space-y-4">
        <PageHeader
          title={editing ? `Edit ${existing?.request_number ?? "draft"}` : "New Supply Request"}
          description="Ask the admin office for stationery, toner, tea or cleaning material. Your department head approves every request."
          icon={PackagePlus}
        />

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Request</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sr-dept">Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger id="sr-dept"><SelectValue placeholder="Choose the department" /></SelectTrigger>
                <SelectContent>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="sr-reason">What are the items needed for?</Label>
              <Textarea id="sr-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Monthly stationery for the Sales desk" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Items</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {items.length === 0 && (
              <p className="text-sm text-muted-foreground">No Office Supplies item is set up yet. Ask Master Data to add items with category Office Supplies.</p>
            )}
            {lines.map((l, idx) => {
              const it = itemById.get(l.item_id);
              return (
                <div key={l.key} className="grid gap-2 sm:grid-cols-[1fr_120px_1fr_auto] items-end rounded border p-2">
                  <div className="grid gap-1">
                    <Label htmlFor={`sr-item-${idx}`} className="text-xs">Item</Label>
                    <Select value={l.item_id} onValueChange={(v) => setLine(l.key, { item_id: v })}>
                      <SelectTrigger id={`sr-item-${idx}`}><SelectValue placeholder="Choose an item" /></SelectTrigger>
                      <SelectContent>
                        {items.filter((i) => i.id === l.item_id || !used.has(i.id)).map((i) => (
                          <SelectItem key={i.id} value={i.id}>{i.code} · {i.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`sr-qty-${idx}`} className="text-xs">Qty{it?.units_of_measure?.symbol ? ` (${it.units_of_measure.symbol})` : ""}</Label>
                    <Input id={`sr-qty-${idx}`} type="number" min={0} step="any" inputMode="decimal" value={l.requested_qty}
                      onChange={(e) => setLine(l.key, { requested_qty: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`sr-rem-${idx}`} className="text-xs">Remarks</Label>
                    <Input id={`sr-rem-${idx}`} value={l.remarks} onChange={(e) => setLine(l.key, { remarks: e.target.value })} />
                  </div>
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove line"
                    onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [newLine()]))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
              <Plus className="h-4 w-4 mr-1" /> Add item
            </Button>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="outline" onClick={() => navigate(-1)} disabled={save.isPending}>Cancel</Button>
          <Button variant="secondary" onClick={() => save.mutate(false)} disabled={!canSave || save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save draft
          </Button>
          <Button onClick={() => save.mutate(true)} disabled={!canSave || save.isPending}>
            <Send className="h-4 w-4 mr-1" /> Submit to department head
          </Button>
        </div>
      </div>
    </ERPLayout>
  );
}
