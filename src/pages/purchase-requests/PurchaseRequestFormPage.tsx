import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ClipboardList, Loader2, Plus, Save, Send, Trash2 } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { PURCHASE_CATEGORY_OPTIONS, purchaseCategoryLabel, type PurchaseCategory } from "@/lib/purchase/categories";
import {
  PR_SELECT, errorMessage, fmtMoney, prDb, sortedItems, todayPk, type PurchaseRequest,
} from "@/lib/purchaseRequest";

type ItemRow = { id: string; code: string; name: string; unit_price: number | null; units_of_measure: { symbol: string } | null };
type Line = { key: string; item_id: string; requested_qty: string; remarks: string };

const newLine = (): Line => ({ key: crypto.randomUUID(), item_id: "", requested_qty: "", remarks: "" });

const CATEGORY_HINT: Record<PurchaseCategory, string> = {
  office_supplies: "Stationery, printer supplies and other office items.",
  raw_material: "Materials that go into production. Add the job order if the need is for one.",
  general_supplies: "Consumables used on the floor: gloves, clippers, tapes and the like.",
  spare_maintenance: "Machine spares and parts. Pick the machine, and tick breakdown if it is stopped.",
};

/**
 * Raise a purchase request, or edit one's own draft. Any logged-in user can
 * raise one; the items come from the item master of the chosen category.
 */
export default function PurchaseRequestFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, canViewPrices } = useAuth();
  const showPrices = canViewPrices();

  const [category, setCategory] = useState<PurchaseCategory | "">("");
  const [departmentId, setDepartmentId] = useState(user?.department_id ?? "");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [requiredBy, setRequiredBy] = useState("");
  const [purpose, setPurpose] = useState("");
  const [machineId, setMachineId] = useState("");
  const [breakdown, setBreakdown] = useState(false);
  const [jobOrder, setJobOrder] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [loaded, setLoaded] = useState(!editing);

  const { data: existing, isLoading: existingLoading } = useQuery<PurchaseRequest | null>({
    queryKey: ["purchase-request", id],
    enabled: editing,
    queryFn: async () => {
      const { data, error } = await prDb.from("purchase_requests").select(PR_SELECT).eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!existing || loaded) return;
    setCategory(existing.category);
    setDepartmentId(existing.department_id);
    setPriority(existing.priority);
    setRequiredBy(existing.required_by ?? "");
    setPurpose(existing.purpose);
    setMachineId(existing.machine_id ?? "");
    setBreakdown(existing.is_breakdown);
    setJobOrder(existing.job_order_ref ?? "");
    setLines(sortedItems(existing).map((i) => ({
      key: i.id, item_id: i.item_id, requested_qty: String(i.requested_qty), remarks: i.remarks ?? "",
    })));
    setLoaded(true);
  }, [existing, loaded]);

  useEffect(() => {
    if (!editing && !departmentId && user?.department_id) setDepartmentId(user.department_id);
  }, [editing, departmentId, user?.department_id]);

  const { data: departments = [] } = useQuery<{ id: string; name: string; code: string }[]>({
    queryKey: ["production-departments-active"],
    queryFn: async () => {
      const { data, error } = await prDb.from("production_departments").select("id, name, code, is_active").order("name");
      if (error) throw error;
      return (data ?? []).filter((d: { is_active: boolean | null }) => d.is_active !== false);
    },
  });

  const { data: items = [] } = useQuery<ItemRow[]>({
    queryKey: ["purchase-request-items", category],
    enabled: Boolean(category),
    queryFn: async () => {
      const { data, error } = await prDb
        .from("items")
        .select("id, code, name, unit_price, units_of_measure(symbol)")
        .eq("category", category)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const { data: machines = [] } = useQuery<{ id: string; code: string; name: string }[]>({
    queryKey: ["machines-active"],
    enabled: category === "spare_maintenance",
    queryFn: async () => {
      const { data, error } = await prDb.from("machines").select("id, code, name, is_active").order("name");
      if (error) throw error;
      return (data ?? []).filter((m: { is_active: boolean | null }) => m.is_active !== false);
    },
  });

  const changeCategory = (c: PurchaseCategory) => {
    if (c === category) return;
    setCategory(c);
    // Items belong to one category: a new category starts the lines again.
    setLines([newLine()]);
  };

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const usedItems = new Set(lines.map((l) => l.item_id).filter(Boolean));
  const estimate = lines.reduce((s, l) => s + Number(l.requested_qty || 0) * Number(itemById.get(l.item_id)?.unit_price ?? 0), 0);

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      const payload = {
        category,
        department_id: departmentId,
        priority: breakdown ? "urgent" : priority,
        required_by: requiredBy || null,
        purpose,
        machine_id: category === "spare_maintenance" ? machineId || null : null,
        is_breakdown: category === "spare_maintenance" && breakdown,
        job_order_ref: category === "raw_material" ? jobOrder || null : null,
        lines: lines
          .filter((l) => l.item_id || l.requested_qty)
          .map((l) => ({ item_id: l.item_id, requested_qty: l.requested_qty, remarks: l.remarks })),
      };
      const { data, error } = await prDb.rpc("purchase_request_save", {
        p_id: id ?? null, p_data: payload, p_submit: submit,
      });
      if (error) throw error;
      return { newId: data as string, submit };
    },
    onSuccess: ({ newId, submit }) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-requests"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-request", newId] });
      toast({ title: submit ? "Purchase request submitted" : "Draft saved" });
      navigate(`/my-purchase-requests/${newId}`, { replace: true });
    },
    onError: (e) => toast({ title: "Could not save", description: errorMessage(e), variant: "destructive" }),
  });

  if (editing && (existingLoading || !loaded)) {
    return (
      <ERPLayout>
        <div className="flex items-center gap-2 text-muted-foreground p-8">
          {existingLoading || existing ? <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</> : "Purchase request not found."}
        </div>
      </ERPLayout>
    );
  }
  if (editing && existing && (existing.status !== "draft" || existing.created_by !== user?.id)) {
    return (
      <ERPLayout>
        <div className="p-8 text-muted-foreground">
          {existing.pr_number} can no longer be edited here — only its maker can edit it, while it is a draft.
        </div>
      </ERPLayout>
    );
  }

  return (
    <ERPLayout>
      <div className="w-full max-w-5xl space-y-4">
        <PageHeader
          title={editing ? `Edit ${existing?.pr_number ?? "purchase request"}` : "New purchase request"}
          description="Ask Purchase to buy items. Your department head approves first, then Purchase."
          icon={ClipboardList}
        />

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Request</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => changeCategory(v as PurchaseCategory)}>
                <SelectTrigger><SelectValue placeholder="Choose the category" /></SelectTrigger>
                <SelectContent>
                  {PURCHASE_CATEGORY_OPTIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {category && <p className="text-xs text-muted-foreground">{CATEGORY_HINT[category]}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <SearchableSelect
                value={departmentId}
                onValueChange={setDepartmentId}
                options={departments.map((d) => ({ value: d.id, label: d.name, secondary: d.code }))}
                placeholder="Choose the department"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={breakdown ? "urgent" : priority} onValueChange={(v) => setPriority(v as "normal" | "urgent")} disabled={breakdown}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-required-by">Required by (optional)</Label>
              <Input id="pr-required-by" type="date" min={todayPk()} value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="pr-purpose">What are the items needed for?</Label>
              <Textarea id="pr-purpose" rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. Monthly stationery for accounts; bearing of Press 1 is worn out" />
            </div>

            {category === "spare_maintenance" && (
              <>
                <div className="space-y-1.5">
                  <Label>Machine (optional)</Label>
                  <SearchableSelect
                    value={machineId}
                    onValueChange={setMachineId}
                    options={machines.map((m) => ({ value: m.id, label: m.name, secondary: m.code }))}
                    placeholder="Choose the machine"
                  />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Checkbox id="pr-breakdown" checked={breakdown} onCheckedChange={(v) => setBreakdown(v === true)} />
                  <Label htmlFor="pr-breakdown" className="font-normal">Machine is stopped (breakdown) — makes the request urgent</Label>
                </div>
              </>
            )}
            {category === "raw_material" && (
              <div className="space-y-1.5">
                <Label htmlFor="pr-job">Job order / production requirement (optional)</Label>
                <Input id="pr-job" value={jobOrder} onChange={(e) => setJobOrder(e.target.value)} placeholder="e.g. JO-00123" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Items{category ? ` — ${purchaseCategoryLabel(category)}` : ""}</CardTitle>
            <Button variant="outline" size="sm" disabled={!category} onClick={() => setLines((ls) => [...ls, newLine()])}>
              <Plus className="h-4 w-4 mr-1" /> Add item
            </Button>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {!category ? (
              <p className="p-4 text-sm text-muted-foreground">Choose the category first — the items come from the item master of that category.</p>
            ) : (
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead className="w-32">Quantity</TableHead>
                    <TableHead className="w-16">Unit</TableHead>
                    {showPrices && <TableHead className="w-28 text-right">Est. rate</TableHead>}
                    <TableHead>Remark</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, n) => {
                    const it = itemById.get(l.item_id);
                    return (
                      <TableRow key={l.key}>
                        <TableCell className="text-muted-foreground">{n + 1}</TableCell>
                        <TableCell className="min-w-[260px]">
                          <SearchableSelect
                            value={l.item_id}
                            onValueChange={(v) => setLine(l.key, { item_id: v })}
                            options={items
                              .filter((i) => i.id === l.item_id || !usedItems.has(i.id))
                              .map((i) => ({ value: i.id, label: i.name, secondary: i.code }))}
                            placeholder="Choose the item"
                            emptyText="No such item in this category. Ask master data to add it."
                          />
                        </TableCell>
                        <TableCell>
                          <Input type="number" min="0" step="any" inputMode="decimal" value={l.requested_qty}
                            onChange={(e) => setLine(l.key, { requested_qty: e.target.value })} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{it?.units_of_measure?.symbol ?? ""}</TableCell>
                        {showPrices && <TableCell className="text-right tabular-nums text-sm">{it ? fmtMoney(it.unit_price) : ""}</TableCell>}
                        <TableCell>
                          <Input value={l.remarks} onChange={(e) => setLine(l.key, { remarks: e.target.value })} placeholder="Size, brand, colour…" />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" aria-label="Remove item" disabled={lines.length === 1}
                            onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            {showPrices && category && (
              <div className="px-4 py-3 border-t text-sm flex justify-end gap-2">
                <span className="text-muted-foreground">Estimated value (item master rates)</span>
                <span className="font-semibold tabular-nums">{fmtMoney(estimate)}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => navigate(-1)} disabled={save.isPending}>Back</Button>
          <Button variant="outline" onClick={() => save.mutate(false)} disabled={save.isPending}>
            <Save className="h-4 w-4 mr-1" /> Save draft
          </Button>
          <Button onClick={() => save.mutate(true)} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />} Submit
          </Button>
        </div>
      </div>
    </ERPLayout>
  );
}
