import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { Link2, Loader2, Plus, Trash2, Warehouse } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { PhotoInput } from "@/components/gate-pass/PhotoInput";
import { SP_SELECT, errorMessage, fmtQty, spDb, type StorePass } from "@/lib/storePass";

type LineEdit = { key: string; description: string; product_id: string; quantity: string; packages: string; remarks: string };
type ProductRow = { id: string; code: string; name: string };

const newLine = (): LineEdit => ({ key: crypto.randomUUID(), description: "", product_id: "", quantity: "", packages: "", remarks: "" });
const NONE = "__none__";

export default function StorePassFormPage() {
  const { id: editId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasModulePermission } = useAuth();
  const canCreate = hasModulePermission("store_pass", "create");

  const [passDate, setPassDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [planNo, setPlanNo] = useState("");
  const [handedTo, setHandedTo] = useState("");
  const [photoPath, setPhotoPath] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<LineEdit[]>([newLine(), newLine(), newLine()]);

  const { data: editing } = useQuery<StorePass | null>({
    queryKey: ["store-pass", editId],
    enabled: Boolean(editId),
    queryFn: async () => {
      const { data, error } = await spDb.from("store_passes").select(SP_SELECT).eq("id", editId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => {
    if (!editing) return;
    setPassDate(editing.pass_date);
    setPlanNo(editing.dispatch_plan_no ?? "");
    setHandedTo(editing.received_by_name ?? "");
    setPhotoPath(editing.photo_path ?? "");
    setRemarks(editing.remarks ?? "");
    const items = [...(editing.store_pass_items ?? [])].sort((a, b) => a.line_no - b.line_no);
    setLines(items.length ? items.map((i) => ({
      key: i.id, description: i.description, product_id: i.product_id ?? "",
      quantity: String(i.quantity), packages: i.packages === null ? "" : String(i.packages), remarks: i.remarks ?? "",
    })) : [newLine()]);
  }, [editing]);

  const { data: products = [] } = useQuery<ProductRow[]>({
    queryKey: ["store-pass-products"],
    queryFn: async () => {
      const { data, error } = await spDb.from("products").select("id, code, name").order("code").limit(3000);
      if (error) return [];
      return data ?? [];
    },
  });

  const setLine = (key: string, patch: Partial<LineEdit>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickProduct = (key: string, productId: string) => {
    const p = products.find((x) => x.id === productId);
    setLines((ls) => ls.map((l) => l.key === key
      ? { ...l, product_id: productId === NONE ? "" : productId, description: p && !l.description.trim() ? `${p.code} · ${p.name}` : l.description }
      : l));
  };
  const filled = lines.filter((l) => l.description.trim() || l.product_id || l.quantity || l.packages);
  const totals = filled.reduce((t, l) => ({ quantity: t.quantity + Number(l.quantity || 0), packages: t.packages + Number(l.packages || 0) }), { quantity: 0, packages: 0 });
  const incomplete = filled.filter((l) => Number(l.quantity || 0) <= 0 && Number(l.packages || 0) <= 0).length;
  const canIssue = Boolean(planNo.trim()) && filled.length > 0 && incomplete === 0 && Boolean(handedTo.trim()) && Boolean(photoPath);

  const save = useMutation({
    mutationFn: async (issue: boolean) => {
      const data: Record<string, unknown> = {
        pass_date: passDate,
        dispatch_plan_no: planNo,
        received_by_name: handedTo,
        photo_path: photoPath,
        remarks,
        lines: filled.map((l) => ({
          description: l.description, product_id: l.product_id || null,
          quantity: l.quantity === "" ? 0 : Number(l.quantity), packages: l.packages === "" ? null : Number(l.packages), remarks: l.remarks,
        })),
      };
      const { data: id, error } = await spDb.rpc("store_pass_save", { p_id: editId ?? null, p_data: data, p_issue: issue });
      if (error) throw error;
      return { id: id as string, issue };
    },
    onSuccess: ({ id, issue }) => {
      ["store-passes", "dispatch-store-pass", "store-gate-tracking", "store-gate-recon"].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      queryClient.invalidateQueries({ queryKey: ["store-pass", id] });
      toast({ title: issue ? "Store pass issued" : "Draft saved", description: issue ? "Time-stamped and ready to print. It travels with the goods to the gate." : undefined });
      navigate(`/store-pass/passes/${id}`);
    },
    onError: (e) => toast({ title: "Could not save", description: errorMessage(e), variant: "destructive" }),
  });

  if (!canCreate) {
    return <ERPLayout><div className="p-8 text-center text-muted-foreground">You do not have permission to make store passes.</div></ERPLayout>;
  }
  if (editId && editing && editing.status !== "draft") {
    return (
      <ERPLayout>
        <div className="p-8 text-center text-muted-foreground">
          {editing.pass_number} is no longer a draft and cannot be edited.{" "}
          <Link className="text-primary underline" to={`/store-pass/passes/${editId}`}>Open it</Link>
        </div>
      </ERPLayout>
    );
  }

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title={editing ? `Edit ${editing.pass_number}` : "New store pass"}
          description="Finished goods handed over at the loading dock. The SP number is given when you save. No stock moves; no prices."
          icon={Warehouse}
        />

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
          <div className="space-y-4 min-w-0">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">1. Dispatch plan</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
                <div>
                  <Label htmlFor="sp-plan">Dispatch plan no. *</Label>
                  <Input id="sp-plan" value={planNo} className="h-11 text-lg" placeholder="e.g. DPV-000012 or DC-00412"
                    onChange={(e) => setPlanNo(e.target.value.toUpperCase())} />
                  <p className="text-xs text-muted-foreground mt-1">Write the number on the dispatch plan. If it is the dispatch (DC) number, the pass links to that dispatch by itself.</p>
                </div>
                <div>
                  <Label htmlFor="sp-date">Date</Label>
                  <Input id="sp-date" type="date" className="h-11" value={passDate} onChange={(e) => setPassDate(e.target.value)} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">2. Items handed over</CardTitle>
                <p className="text-sm text-muted-foreground">Type each item as it is. Picking the product is optional; it helps the per-product reconciliation.</p>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[780px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Item *</TableHead>
                      <TableHead className="w-56">Product (optional)</TableHead>
                      <TableHead className="text-right w-28">Dozens</TableHead>
                      <TableHead className="text-right w-28">Cartons</TableHead>
                      <TableHead>Remark</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, n) => {
                      const bad = (l.description.trim() || l.product_id) && Number(l.quantity || 0) <= 0 && Number(l.packages || 0) <= 0;
                      return (
                        <TableRow key={l.key}>
                          <TableCell className="text-muted-foreground">{n + 1}</TableCell>
                          <TableCell>
                            <Input aria-label={`Item ${n + 1}`} className="h-10 min-w-[200px]" value={l.description} placeholder="e.g. Football size 5 white, 10 ctn"
                              onChange={(e) => setLine(l.key, { description: e.target.value })} />
                          </TableCell>
                          <TableCell>
                            <Select value={l.product_id || NONE} onValueChange={(v) => pickProduct(l.key, v)}>
                              <SelectTrigger className="h-10"><SelectValue placeholder="—" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>— none —</SelectItem>
                                {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} · {p.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input aria-label={`Dozens ${n + 1}`} inputMode="decimal" className={cn("h-10 text-right tabular-nums", bad && "border-amber-500")} value={l.quantity}
                              onChange={(e) => setLine(l.key, { quantity: e.target.value.replace(/[^0-9.]/g, "") })} />
                          </TableCell>
                          <TableCell>
                            <Input aria-label={`Cartons ${n + 1}`} inputMode="numeric" className={cn("h-10 text-right tabular-nums", bad && "border-amber-500")} value={l.packages}
                              onChange={(e) => setLine(l.key, { packages: e.target.value.replace(/[^0-9]/g, "") })} />
                          </TableCell>
                          <TableCell>
                            <Input aria-label={`Remark ${n + 1}`} className="h-10 min-w-[140px]" value={l.remarks} onChange={(e) => setLine(l.key, { remarks: e.target.value })} />
                          </TableCell>
                          <TableCell>
                            <Button type="button" variant="ghost" size="icon" aria-label="Remove line" disabled={lines.length === 1}
                              onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <tfoot>
                    <TableRow>
                      <TableCell colSpan={3}>
                        <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
                          <Plus className="h-4 w-4 mr-1" /> Add item
                        </Button>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{fmtQty(totals.quantity)} dz</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{totals.packages} ctn</TableCell>
                      <TableCell colSpan={2} className="text-xs text-muted-foreground">{filled.length} item(s){incomplete ? ` · ${incomplete} without a quantity` : ""}</TableCell>
                    </TableRow>
                  </tfoot>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">3. Hand-over</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="sp-handed">Handed over to (person's name) *</Label>
                    <Input id="sp-handed" className="h-11" value={handedTo} placeholder="e.g. Imran (loader)" onChange={(e) => setHandedTo(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="sp-remarks">Remarks</Label>
                    <Textarea id="sp-remarks" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label>Photo of the stock at the loading dock *</Label>
                  <PhotoInput id="sp-photo" label="Take photo of the stock" folder="store-pass" value={photoPath} onChange={setPhotoPath} />
                  {!photoPath && <p className="text-xs text-muted-foreground mt-1">Needed to issue the pass. A draft can be saved without it.</p>}
                </div>
              </CardContent>
            </Card>

            <div className="rounded-xl border p-4 bg-muted/30 text-sm text-muted-foreground flex gap-3">
              <Link2 className="h-5 w-5 shrink-0 mt-0.5" />
              <div>
                <b className="text-foreground">Linking to the dispatch sheet is not your job.</b> The dispatch operator links this pass to its
                dispatch (DC) from the Domestic Dispatch page once the sheet is made; the plan number you write tells them which one.
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Summary</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">SP number</span><span className="font-medium">{editing?.pass_number ?? "Given on save"}</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Dispatch plan</span><span className="font-medium text-right">{planNo || "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Items</span><span className="font-medium">{filled.length}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-medium">{fmtQty(totals.quantity)} dz · {totals.packages} ctn</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Handed over to</span><span className="font-medium text-right">{handedTo || "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Photo</span><span className={cn("font-medium", photoPath ? "text-emerald-700" : "text-amber-700")}>{photoPath ? "Taken" : "Missing"}</span></div>
              </CardContent>
            </Card>

            {!canIssue && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-1">
                <div className="font-semibold">To issue, still needed:</div>
                <ul className="list-disc pl-4">
                  {!planNo.trim() && <li>the dispatch plan number</li>}
                  {filled.length === 0 && <li>at least one item</li>}
                  {incomplete > 0 && <li>a quantity on every item</li>}
                  {!handedTo.trim() && <li>who the goods were handed over to</li>}
                  {!photoPath && <li>the photo of the stock at the loading dock</li>}
                </ul>
              </div>
            )}

            <div className="rounded-xl border p-4 bg-muted/30 text-sm text-muted-foreground">
              Issuing stamps the time and your name and freezes the pass. After issue only a store pass manager can cancel it.
            </div>

            <div className="flex flex-col gap-2">
              <Button className="h-12 text-base" disabled={save.isPending || !canIssue} onClick={() => save.mutate(true)}>
                {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Issue store pass
              </Button>
              <Button variant="outline" disabled={save.isPending || !planNo.trim() || filled.length === 0} onClick={() => save.mutate(false)}>Save as draft</Button>
            </div>
          </div>
        </div>
      </div>
    </ERPLayout>
  );
}
