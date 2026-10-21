import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Loader2, PackageOpen, Plus, ShoppingCart, SlidersHorizontal } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, facilitiesCan, fcDb, fmtDateTime, fmtQty } from "@/lib/facilities";
import {
  SR_LIST_SELECT, adjustStock, loadDepartments, loadHeadDepartments, loadLedger, loadOfficeItems, loadShortage,
  loadStoreItems, receiveStock, reorderToPrq, saveStoreItem, type StoreItemRow, type SupplyRequestListRow,
} from "@/lib/facilitiesSupplies";
import { SupplyRequestTable } from "./MySupplyRequestsPage";

type Tab = "approve" | "issue" | "all" | "stock" | "shortage";

/**
 * The admin store: requests to approve (department heads) and to issue
 * (admin officer), the stock with its reorder levels, and the shortage list
 * that turns into a purchase request.
 */
export default function AdminStorePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, roles } = useAuth();
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const canOperate = facilitiesCan(roles, "operate");
  const canManage = facilitiesCan(roles, "manage");
  const [tab, setTab] = useState<Tab>("issue");

  const { data: headDepartments = [] } = useQuery({
    queryKey: ["purchase-request-my-head-departments", user?.id], enabled: Boolean(user?.id), queryFn: () => loadHeadDepartments(user!.id),
  });
  const isHead = isSuperAdmin || headDepartments.length > 0;

  const useRequestList = (key: string, build: (q: ReturnType<typeof fcDb.from>) => unknown, enabled = true) =>
    useQuery<SupplyRequestListRow[]>({
      queryKey: ["facilities-supply-requests", key, user?.id, headDepartments],
      enabled,
      queryFn: async () => {
        const { data, error } = await (build(fcDb.from("facilities_supply_requests").select(SR_LIST_SELECT)) as Promise<{ data: SupplyRequestListRow[]; error: unknown }>);
        if (error) throw error;
        return data ?? [];
      },
    });
  const toApprove = useRequestList("admin-hod", (q) => {
    let x = q.eq("status", "pending_hod");
    if (!isSuperAdmin) x = x.in("department_id", headDepartments);
    return x.order("submitted_at");
  }, isHead);
  const toIssue = useRequestList("admin-issue", (q) => q.eq("status", "approved").order("hod_at"));
  const all = useRequestList("admin-all", (q) => q.order("created_at", { ascending: false }).limit(500), tab === "all");

  const { data: stock = [], isLoading: stockLoading } = useQuery({ queryKey: ["facilities-store-items"], queryFn: loadStoreItems });
  const { data: shortage = [] } = useQuery({ queryKey: ["facilities-store-shortage"], queryFn: loadShortage });
  const { data: officeItems = [] } = useQuery({ queryKey: ["facilities-office-items"], queryFn: loadOfficeItems, enabled: canManage });
  const { data: departments = [] } = useQuery({ queryKey: ["production-departments-active"], queryFn: loadDepartments });

  const [stockSearch, setStockSearch] = useState("");
  const filteredStock = useMemo(() => {
    const q = stockSearch.trim().toLowerCase();
    return stock.filter((s) => !q || s.item?.name.toLowerCase().includes(q) || s.item?.code.toLowerCase().includes(q));
  }, [stock, stockSearch]);

  // Dialogs
  const [setup, setSetup] = useState<{ row: StoreItemRow | null } | null>(null);
  const [setupItem, setSetupItem] = useState("");
  const [setupForm, setSetupForm] = useState({ reorder_level: "", reorder_qty: "", location: "", is_active: true });
  const [adjust, setAdjust] = useState<StoreItemRow | null>(null);
  const [adjustForm, setAdjustForm] = useState({ qty: "", reason: "", entry_type: "adjustment" as "opening" | "adjustment" | "receipt" });
  const [ledgerOf, setLedgerOf] = useState<StoreItemRow | null>(null);
  const [reorder, setReorder] = useState(false);
  const [reorderItems, setReorderItems] = useState<Set<string>>(new Set());
  const [reorderDept, setReorderDept] = useState(user?.department_id ?? "");
  const [reorderPurpose, setReorderPurpose] = useState("");

  const { data: ledger = [] } = useQuery({
    queryKey: ["facilities-store-ledger", ledgerOf?.item_id], enabled: Boolean(ledgerOf), queryFn: () => loadLedger(ledgerOf!.item_id),
  });

  const refreshStock = () => {
    queryClient.invalidateQueries({ queryKey: ["facilities-store-items"] });
    queryClient.invalidateQueries({ queryKey: ["facilities-store-shortage"] });
    queryClient.invalidateQueries({ queryKey: ["facilities-store-ledger"] });
  };
  const fail = (e: unknown) => toast({ title: "Not saved", description: errorMessage(e), variant: "destructive" });

  const saveSetup = useMutation({
    mutationFn: () => saveStoreItem(setup?.row?.item_id ?? setupItem, {
      reorder_level: Number(setupForm.reorder_level || 0), reorder_qty: Number(setupForm.reorder_qty || 0),
      location: setupForm.location, is_active: setupForm.is_active,
    }),
    onSuccess: () => { toast({ title: "Store item saved" }); refreshStock(); setSetup(null); },
    onError: fail,
  });
  const saveAdjust = useMutation({
    mutationFn: () => adjustForm.entry_type === "receipt"
      ? receiveStock(adjust!.item_id, Number(adjustForm.qty))
      : adjustStock(adjust!.item_id, Number(adjustForm.qty), adjustForm.reason, adjustForm.entry_type),
    onSuccess: (balance) => { toast({ title: "Stock updated", description: `${adjust?.item?.name}: now ${fmtQty(balance)}` }); refreshStock(); setAdjust(null); },
    onError: fail,
  });
  const raisePrq = useMutation({
    mutationFn: () => reorderToPrq(reorderItems.size ? [...reorderItems] : null, reorderDept, reorderPurpose),
    onSuccess: (prqId) => {
      toast({ title: "Purchase request drafted", description: "Review it and submit it to the department head." });
      queryClient.invalidateQueries({ queryKey: ["purchase-requests"] });
      setReorder(false);
      navigate(`/my-purchase-requests/${prqId}`);
    },
    onError: fail,
  });

  const openSetup = (row: StoreItemRow | null) => {
    setSetup({ row });
    setSetupItem(row?.item_id ?? "");
    setSetupForm({ reorder_level: row ? String(row.reorder_level) : "", reorder_qty: row ? String(row.reorder_qty) : "", location: row?.location ?? "", is_active: row?.is_active ?? true });
  };
  const openAdjust = (row: StoreItemRow, type: "opening" | "adjustment" | "receipt") => {
    setAdjust(row);
    setAdjustForm({ qty: "", reason: "", entry_type: type });
  };
  const openReorder = () => {
    setReorderItems(new Set(shortage.map((s) => s.item_id)));
    setReorderDept(user?.department_id ?? departments[0]?.id ?? "");
    setReorderPurpose("");
    setReorder(true);
  };
  const stockBadge = (s: { on_hand: number; reorder_level: number }) =>
    Number(s.on_hand) <= 0 ? <Badge variant="destructive">{fmtQty(s.on_hand)}</Badge>
      : Number(s.on_hand) <= Number(s.reorder_level) ? <Badge variant="warning">{fmtQty(s.on_hand)}</Badge>
      : <span className="tabular-nums">{fmtQty(s.on_hand)}</span>;

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Admin Store & Supply Requests" description="Office consumables kept by the admin office: requests, stock and reorders" icon={PackageOpen}>
          {canManage && <Button variant="outline" onClick={() => openSetup(null)}><Plus className="h-4 w-4 mr-1" /> Add store item</Button>}
          {canOperate && (
            <Button onClick={openReorder} disabled={shortage.length === 0}>
              <ShoppingCart className="h-4 w-4 mr-1" /> Raise purchase request{shortage.length ? ` (${shortage.length})` : ""}
            </Button>
          )}
        </PageHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="flex-wrap h-auto">
            {isHead && <TabsTrigger value="approve">To approve{toApprove.data?.length ? ` (${toApprove.data.length})` : ""}</TabsTrigger>}
            <TabsTrigger value="issue">To issue{toIssue.data?.length ? ` (${toIssue.data.length})` : ""}</TabsTrigger>
            <TabsTrigger value="all">All requests</TabsTrigger>
            <TabsTrigger value="stock">Stock ({stock.length})</TabsTrigger>
            <TabsTrigger value="shortage">Shortage{shortage.length ? ` (${shortage.length})` : ""}</TabsTrigger>
          </TabsList>
        </Tabs>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {tab === "approve" && <SupplyRequestTable rows={toApprove.data ?? []} basePath="/facilities/supplies" isLoading={toApprove.isLoading} emptyText="Nothing is waiting for your approval." />}
            {tab === "issue" && <SupplyRequestTable rows={toIssue.data ?? []} basePath="/facilities/supplies" isLoading={toIssue.isLoading} emptyText="Nothing approved is waiting to be issued." />}
            {tab === "all" && <SupplyRequestTable rows={all.data ?? []} basePath="/facilities/supplies" isLoading={all.isLoading} />}
            {tab === "stock" && (
              <>
                <div className="p-3 border-b">
                  <Input placeholder="Search item" value={stockSearch} onChange={(e) => setStockSearch(e.target.value)} className="sm:w-64" />
                </div>
                <Table className="min-w-[800px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead className="text-right">Reorder level</TableHead>
                      <TableHead className="text-right">Reorder qty</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead className="text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stockLoading ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                    ) : filteredStock.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No store item yet. A facilities manager adds items with "Add store item".</TableCell></TableRow>
                    ) : filteredStock.map((s) => (
                      <TableRow key={s.item_id} className={s.is_active ? "" : "opacity-60"}>
                        <TableCell>
                          <span className="font-mono text-xs text-muted-foreground">{s.item?.code}</span> {s.item?.name}
                          {s.item?.units_of_measure?.symbol && <span className="text-xs text-muted-foreground"> · {s.item.units_of_measure.symbol}</span>}
                          {!s.is_active && <Badge variant="secondary" className="ml-2">inactive</Badge>}
                        </TableCell>
                        <TableCell className="text-right">{stockBadge(s)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtQty(s.reorder_level)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtQty(s.reorder_qty)}</TableCell>
                        <TableCell className="text-sm">{s.location ?? "—"}</TableCell>
                        <TableCell className="text-sm tabular-nums">{fmtDateTime(s.updated_at)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap gap-1 justify-end">
                            <Button size="sm" variant="ghost" onClick={() => setLedgerOf(s)}>Ledger</Button>
                            {canOperate && <Button size="sm" variant="outline" onClick={() => openAdjust(s, "receipt")}>Receive</Button>}
                            {canManage && <Button size="sm" variant="outline" onClick={() => openAdjust(s, "adjustment")}>Adjust</Button>}
                            {canManage && <Button size="sm" variant="ghost" aria-label="Settings" onClick={() => openSetup(s)}><SlidersHorizontal className="h-4 w-4" /></Button>}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
            {tab === "shortage" && (
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead className="text-right">Reorder level</TableHead>
                    <TableHead className="text-right">Reorder qty</TableHead>
                    <TableHead>Location</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shortage.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No item is at or below its reorder level.</TableCell></TableRow>
                  ) : shortage.map((s) => (
                    <TableRow key={s.item_id}>
                      <TableCell><span className="font-mono text-xs text-muted-foreground">{s.item_code}</span> {s.item_name}{s.uom ? <span className="text-xs text-muted-foreground"> · {s.uom}</span> : null}</TableCell>
                      <TableCell className="text-right">{stockBadge(s)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(s.reorder_level)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(s.reorder_qty)}{Number(s.reorder_qty) <= 0 && <Badge variant="warning" className="ml-2">set reorder qty</Badge>}</TableCell>
                      <TableCell className="text-sm">{s.location ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Store item setup */}
      <Dialog open={Boolean(setup)} onOpenChange={(o) => { if (!o) setSetup(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{setup?.row ? `${setup.row.item?.code} ${setup.row.item?.name}` : "Add a store item"}</DialogTitle>
            <DialogDescription>Items come from Master Data › Items, category Office Supplies.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {!setup?.row && (
              <div className="grid gap-1.5">
                <Label htmlFor="st-item">Item</Label>
                <Select value={setupItem} onValueChange={setSetupItem}>
                  <SelectTrigger id="st-item"><SelectValue placeholder="Choose an item" /></SelectTrigger>
                  <SelectContent>
                    {officeItems.filter((i) => !stock.some((s) => s.item_id === i.id)).map((i) => (
                      <SelectItem key={i.id} value={i.id}>{i.code} · {i.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label htmlFor="st-rl">Reorder level</Label>
                <Input id="st-rl" type="number" min={0} step="any" value={setupForm.reorder_level} onChange={(e) => setSetupForm((f) => ({ ...f, reorder_level: e.target.value }))} /></div>
              <div className="grid gap-1.5"><Label htmlFor="st-rq">Reorder quantity</Label>
                <Input id="st-rq" type="number" min={0} step="any" value={setupForm.reorder_qty} onChange={(e) => setSetupForm((f) => ({ ...f, reorder_qty: e.target.value }))} /></div>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="st-loc">Location in the store</Label>
              <Input id="st-loc" value={setupForm.location} onChange={(e) => setSetupForm((f) => ({ ...f, location: e.target.value }))} /></div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={setupForm.is_active} onCheckedChange={(v) => setSetupForm((f) => ({ ...f, is_active: v === true }))} /> Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSetup(null)}>Cancel</Button>
            <Button onClick={() => saveSetup.mutate()} disabled={saveSetup.isPending || (!setup?.row && !setupItem)}>
              {saveSetup.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjust / receive */}
      <Dialog open={Boolean(adjust)} onOpenChange={(o) => { if (!o) setAdjust(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{adjustForm.entry_type === "receipt" ? "Receive into the store" : "Stock adjustment"}</DialogTitle>
            <DialogDescription>{adjust?.item?.code} {adjust?.item?.name} · on hand {fmtQty(adjust?.on_hand)}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {adjustForm.entry_type !== "receipt" && (
              <div className="grid gap-1.5">
                <Label htmlFor="adj-type">Type</Label>
                <Select value={adjustForm.entry_type} onValueChange={(v) => setAdjustForm((f) => ({ ...f, entry_type: v as "opening" | "adjustment" }))}>
                  <SelectTrigger id="adj-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="adjustment">Adjustment (counted difference)</SelectItem>
                    <SelectItem value="opening">Opening stock</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="adj-qty">{adjustForm.entry_type === "receipt" ? "Quantity received" : "Quantity (negative to reduce)"}</Label>
              <Input id="adj-qty" type="number" step="any" inputMode="decimal" value={adjustForm.qty} onChange={(e) => setAdjustForm((f) => ({ ...f, qty: e.target.value }))} />
            </div>
            {adjustForm.entry_type !== "receipt" && (
              <div className="grid gap-1.5">
                <Label htmlFor="adj-reason">Reason</Label>
                <Textarea id="adj-reason" rows={2} value={adjustForm.reason} onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjust(null)}>Cancel</Button>
            <Button onClick={() => saveAdjust.mutate()} disabled={saveAdjust.isPending || !adjustForm.qty || (adjustForm.entry_type !== "receipt" && !adjustForm.reason.trim())}>
              {saveAdjust.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ledger */}
      <Dialog open={Boolean(ledgerOf)} onOpenChange={(o) => { if (!o) setLedgerOf(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ledger · {ledgerOf?.item?.code} {ledgerOf?.item?.name}</DialogTitle>
            <DialogDescription>Every change of the stock, latest first.</DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto max-h-[60vh]">
            <Table className="min-w-[520px]">
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Reason / ref</TableHead><TableHead>By</TableHead></TableRow></TableHeader>
              <TableBody>
                {ledger.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No entries.</TableCell></TableRow>
                ) : ledger.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="tabular-nums text-sm">{fmtDateTime(l.created_at)}</TableCell>
                    <TableCell>{l.entry_type}</TableCell>
                    <TableCell className={`text-right tabular-nums ${Number(l.qty) < 0 ? "text-destructive" : "text-emerald-700"}`}>{Number(l.qty) > 0 ? "+" : ""}{fmtQty(l.qty)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtQty(l.balance_after)}</TableCell>
                    <TableCell className="text-sm">{l.reason ?? (l.ref_type ? `${l.ref_type}` : "—")}</TableCell>
                    <TableCell className="text-sm">{l.actor?.full_name ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reorder → purchase request */}
      <Dialog open={reorder} onOpenChange={setReorder}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Raise a purchase request</DialogTitle>
            <DialogDescription>A draft PRQ (Office Supplies) with each item's reorder quantity. You review and submit it on My Purchase Requests.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ro-dept">Department</Label>
              <Select value={reorderDept} onValueChange={setReorderDept}>
                <SelectTrigger id="ro-dept"><SelectValue placeholder="Choose the department" /></SelectTrigger>
                <SelectContent>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Items</Label>
              <div className="max-h-56 overflow-y-auto rounded border divide-y">
                {shortage.map((s) => (
                  <label key={s.item_id} className="flex items-center gap-2 p-2 text-sm">
                    <Checkbox checked={reorderItems.has(s.item_id)} onCheckedChange={(v) => setReorderItems((set) => {
                      const n = new Set(set); if (v === true) n.add(s.item_id); else n.delete(s.item_id); return n;
                    })} />
                    <span className="flex-1">{s.item_name}</span>
                    <span className="tabular-nums text-muted-foreground">{fmtQty(s.on_hand)} → order {fmtQty(s.reorder_qty)}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ro-purpose">Purpose</Label>
              <Input id="ro-purpose" placeholder="Admin store reorder" value={reorderPurpose} onChange={(e) => setReorderPurpose(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReorder(false)}>Cancel</Button>
            <Button onClick={() => raisePrq.mutate()} disabled={raisePrq.isPending || !reorderDept || reorderItems.size === 0}>
              {raisePrq.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Draft purchase request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
