import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, Pencil, Plus, Receipt, Search, Smartphone } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  errorMessage, facilitiesCan, fcDb, fmtDate, fmtMoney, loadActiveEmployees, todayPk, employeeLabel,
} from "@/lib/facilities";
import {
  SIM_MOVEMENT_SELECT, SIM_NETWORKS, SIM_TYPE_LABEL, loadSims, moveSim, saveSim, simStatusMeta,
  type Sim, type SimMovement,
} from "@/lib/facilitiesSims";

const ALL = "__all__";
const NONE = "__none__";

type SimForm = {
  sim_number: string; network: string; package_name: string; package_cost: string; monthly_limit: string;
  sim_type: string; handset_asset_id: string; iccid: string; puk: string; remarks: string; is_active: boolean;
};
const emptyForm = (): SimForm => ({
  sim_number: "", network: "Jazz", package_name: "", package_cost: "0", monthly_limit: "0",
  sim_type: "voice", handset_asset_id: "", iccid: "", puk: "", remarks: "", is_active: true,
});

type MoveKind = "issue" | "return" | "status";
type MoveForm = { movement_type: MoveKind; to_employee_id: string; movement_date: string; new_status: string; remarks: string };

export default function SimsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles } = useAuth();
  const canManage = facilitiesCan(roles, "manage");
  const canOperate = facilitiesCan(roles, "operate");

  const [tab, setTab] = useState<"register" | "movements">("register");
  const [search, setSearch] = useState("");
  const [network, setNetwork] = useState(ALL);
  const [status, setStatus] = useState(ALL);

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<SimForm>(emptyForm());

  const [moveSimRow, setMoveSimRow] = useState<Sim | null>(null);
  const [move, setMove] = useState<MoveForm>({ movement_type: "issue", to_employee_id: "", movement_date: todayPk(), new_status: "suspended", remarks: "" });

  const { data: sims = [], isLoading } = useQuery<Sim[]>({ queryKey: ["facilities-sims"], queryFn: loadSims });

  const { data: employees = [] } = useQuery({ queryKey: ["facilities-employees-active"], queryFn: loadActiveEmployees });

  const { data: handsets = [] } = useQuery<{ id: string; asset_code: string; name: string }[]>({
    queryKey: ["facilities-office-assets-handsets"],
    enabled: editOpen,
    queryFn: async () => {
      const { data, error } = await fcDb.from("fixed_assets").select("id, asset_code, name")
        .eq("category", "office_assets").neq("status", "disposed").order("asset_code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: movements = [], isLoading: movementsLoading } = useQuery<SimMovement[]>({
    queryKey: ["facilities-sim-movements"],
    enabled: tab === "movements",
    queryFn: async () => {
      const { data, error } = await fcDb.from("facilities_sim_movements").select(SIM_MOVEMENT_SELECT)
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const lastMonth = useMemo(() => {
    const d = new Date(`${todayPk()}T00:00:00`);
    d.setDate(1); d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  }, []);
  const { data: overLastMonth = { count: 0, total: 0 } } = useQuery<{ count: number; total: number }>({
    queryKey: ["facilities-sim-over-last-month", lastMonth],
    queryFn: async () => {
      const { data, error } = await fcDb.from("facilities_sim_bills")
        .select("over_limit_count, over_limit_total").eq("status", "posted").eq("bill_month", lastMonth);
      if (error) throw error;
      const rows = (data ?? []) as { over_limit_count: number; over_limit_total: number }[];
      return {
        count: rows.reduce((s, r) => s + Number(r.over_limit_count), 0),
        total: rows.reduce((s, r) => s + Number(r.over_limit_total), 0),
      };
    },
  });

  const active = sims.filter((s) => s.is_active);
  const issued = active.filter((s) => s.status === "issued");
  const inStock = active.filter((s) => s.status === "in_stock");
  const packageCost = active.filter((s) => s.status === "issued" || s.status === "suspended")
    .reduce((sum, s) => sum + Number(s.package_cost), 0);
  const byNetwork = SIM_NETWORKS.map((n) => ({ n, c: active.filter((s) => s.network === n).length })).filter((x) => x.c > 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sims.filter((s) => {
      if (network !== ALL && s.network !== network) return false;
      if (status !== ALL && s.status !== status) return false;
      if (!q) return true;
      const hay = [s.sim_number, s.package_name ?? "", s.holder?.full_name ?? "", s.holder?.employee_code ?? "", s.handset?.asset_code ?? ""]
        .join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [sims, search, network, status]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["facilities-sims"] });
    queryClient.invalidateQueries({ queryKey: ["facilities-sim-movements"] });
  };

  const saveMutation = useMutation({
    mutationFn: () => saveSim(editId, {
      ...form,
      package_cost: Number(form.package_cost || 0),
      monthly_limit: Number(form.monthly_limit || 0),
      handset_asset_id: form.handset_asset_id === NONE ? "" : form.handset_asset_id,
    }),
    onSuccess: () => { toast({ title: editId ? "SIM updated" : "SIM added" }); setEditOpen(false); refresh(); },
    onError: (e) => toast({ title: "Not saved", description: errorMessage(e), variant: "destructive" }),
  });

  const moveMutation = useMutation({
    mutationFn: () => moveSim({
      sim_id: moveSimRow?.id,
      movement_type: move.movement_type,
      to_employee_id: move.movement_type === "issue" ? move.to_employee_id : null,
      movement_date: move.movement_date,
      new_status: move.movement_type === "status" ? move.new_status : null,
      remarks: move.remarks,
    }),
    onSuccess: () => {
      toast({ title: move.movement_type === "issue" ? "SIM issued" : move.movement_type === "return" ? "SIM taken back" : "Status changed" });
      setMoveSimRow(null); refresh();
    },
    onError: (e) => toast({ title: "Not saved", description: errorMessage(e), variant: "destructive" }),
  });

  const openNew = () => { setEditId(null); setForm(emptyForm()); setEditOpen(true); };
  const openEdit = (s: Sim) => {
    setEditId(s.id);
    setForm({
      sim_number: s.sim_number, network: s.network, package_name: s.package_name ?? "",
      package_cost: String(s.package_cost ?? 0), monthly_limit: String(s.monthly_limit ?? 0), sim_type: s.sim_type,
      handset_asset_id: s.handset_asset_id ?? "", iccid: s.iccid ?? "", puk: s.puk ?? "", remarks: s.remarks ?? "", is_active: s.is_active,
    });
    setEditOpen(true);
  };
  const openMove = (s: Sim, kind: MoveKind) => {
    setMoveSimRow(s);
    setMove({ movement_type: kind, to_employee_id: "", movement_date: todayPk(), new_status: s.status === "suspended" ? "in_stock" : "suspended", remarks: "" });
  };

  const employeeOptions = employees.map((e) => ({ value: e.id, label: e.full_name, secondary: e.employee_code, search: e.department?.name ?? "" }));

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="SIM Register" description="Company SIM cards: who holds which number, packages, limits and movements" icon={Smartphone}>
          <Button variant="outline" asChild><Link to="/facilities/sims/bills"><Receipt className="h-4 w-4 mr-1" /> Monthly bills</Link></Button>
          {canManage && <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Add SIM</Button>}
        </PageHeader>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Tile label="Total SIMs" value={active.length} sub={byNetwork.map((x) => `${x.n} ${x.c}`).join(" · ") || "none yet"} />
          <Tile label="Issued" value={issued.length} sub={`${active.filter((s) => s.status === "suspended").length} suspended`} />
          <Tile label="In stock" value={inStock.length} sub={`${active.filter((s) => s.status === "lost" || s.status === "closed").length} lost / closed`} />
          <Tile label="Over limit last month" value={overLastMonth.count} sub={overLastMonth.count ? `PKR ${fmtMoney(overLastMonth.total)} · company bears` : "none posted"} tone={overLastMonth.count ? "warn" : undefined} />
          <Tile label="Monthly package cost" value={`PKR ${fmtMoney(packageCost)}`} sub="issued + suspended" />
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "register" | "movements")}>
          <TabsList>
            <TabsTrigger value="register">Register</TabsTrigger>
            <TabsTrigger value="movements">Movements</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "register" ? (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap gap-2 items-end">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input id="sim-search" className="pl-8" placeholder="Number, holder, package…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Select value={network} onValueChange={setNetwork}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All networks</SelectItem>
                    {SIM_NETWORKS.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All statuses</SelectItem>
                    {(["in_stock", "issued", "suspended", "lost", "closed"] as const).map((s) => (
                      <SelectItem key={s} value={s}>{simStatusMeta(s).label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="overflow-x-auto -mx-4 px-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Number</TableHead>
                      <TableHead>Network</TableHead>
                      <TableHead>Package</TableHead>
                      <TableHead className="text-right">Limit</TableHead>
                      <TableHead>Holder</TableHead>
                      <TableHead>Handset</TableHead>
                      {canManage && <TableHead>ICCID / PUK</TableHead>}
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
                    ) : filtered.length === 0 ? (
                      <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">No SIM matches.</TableCell></TableRow>
                    ) : filtered.map((s) => {
                      const meta = simStatusMeta(s.status);
                      return (
                        <TableRow key={s.id} className={cn(!s.is_active && "opacity-60")}>
                          <TableCell className="font-mono whitespace-nowrap">{s.sim_number}{!s.is_active && <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>}</TableCell>
                          <TableCell>{s.network}</TableCell>
                          <TableCell>
                            <div>{s.package_name ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{SIM_TYPE_LABEL[s.sim_type]} · PKR {fmtMoney(s.package_cost)}/mo</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoney(s.monthly_limit)}</TableCell>
                          <TableCell>
                            {s.holder ? (
                              <div>
                                <div>{s.holder.full_name}</div>
                                <div className="text-xs text-muted-foreground">{s.holder.employee_code}{s.holder.department?.name ? ` · ${s.holder.department.name}` : ""}</div>
                              </div>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{s.handset ? `${s.handset.asset_code} ${s.handset.name}` : "—"}</TableCell>
                          {canManage && (
                            <TableCell className="font-mono text-xs">
                              <div>{s.iccid ?? "—"}</div>
                              <div className="text-muted-foreground">PUK {s.puk ?? "—"}</div>
                            </TableCell>
                          )}
                          <TableCell><Badge variant={meta.variant}>{meta.label}</Badge></TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            {canOperate && s.is_active && s.status === "in_stock" && (
                              <Button size="sm" variant="outline" onClick={() => openMove(s, "issue")}><ArrowUpRight className="h-3.5 w-3.5 mr-1" />Issue</Button>
                            )}
                            {canOperate && (s.status === "issued" || s.status === "suspended") && s.holder_employee_id && (
                              <Button size="sm" variant="outline" className="ml-1" onClick={() => openMove(s, "return")}><ArrowDownLeft className="h-3.5 w-3.5 mr-1" />Return</Button>
                            )}
                            {canOperate && (
                              <Button size="sm" variant="ghost" className="ml-1" onClick={() => openMove(s, "status")}>Status</Button>
                            )}
                            {canManage && (
                              <Button size="sm" variant="ghost" className="ml-1" onClick={() => openEdit(s)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>No.</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>SIM</TableHead>
                    <TableHead>Movement</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Remarks</TableHead>
                    <TableHead>By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movementsLoading ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
                  ) : movements.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No movements yet.</TableCell></TableRow>
                  ) : movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono">{m.movement_number}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtDate(m.movement_date)}</TableCell>
                      <TableCell className="font-mono whitespace-nowrap">{m.sim?.sim_number} <span className="font-sans text-xs text-muted-foreground">{m.sim?.network}</span></TableCell>
                      <TableCell>
                        {m.movement_type === "issue" ? "Issued" : m.movement_type === "return" ? "Returned" : `Marked ${simStatusMeta(m.new_status).label.toLowerCase()}`}
                      </TableCell>
                      <TableCell>{m.from_employee ? `${m.from_employee.full_name} (${m.from_employee.employee_code})` : "Admin store"}</TableCell>
                      <TableCell>{m.to_employee ? `${m.to_employee.full_name} (${m.to_employee.employee_code})` : m.movement_type === "return" ? "Admin store" : "—"}</TableCell>
                      <TableCell className="max-w-[260px]">{m.remarks ?? "—"}</TableCell>
                      <TableCell>{m.actor?.full_name ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Add / edit SIM */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editId ? "Edit SIM" : "Add SIM"}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="sim-number">SIM number</Label>
                <Input id="sim-number" placeholder="0300-1234567" value={form.sim_number} onChange={(e) => setForm({ ...form, sim_number: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sim-network">Network</Label>
                <Select value={form.network} onValueChange={(v) => setForm({ ...form, network: v })}>
                  <SelectTrigger id="sim-network"><SelectValue /></SelectTrigger>
                  <SelectContent>{SIM_NETWORKS.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="sim-package">Package</Label>
                <Input id="sim-package" placeholder="Business 1500" value={form.package_name} onChange={(e) => setForm({ ...form, package_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sim-type">Type</Label>
                <Select value={form.sim_type} onValueChange={(v) => setForm({ ...form, sim_type: v })}>
                  <SelectTrigger id="sim-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SIM_TYPE_LABEL) as (keyof typeof SIM_TYPE_LABEL)[]).map((t) => <SelectItem key={t} value={t}>{SIM_TYPE_LABEL[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="sim-cost">Package cost (PKR / month)</Label>
                <Input id="sim-cost" type="number" min={0} value={form.package_cost} onChange={(e) => setForm({ ...form, package_cost: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sim-limit">Monthly limit (PKR)</Label>
                <Input id="sim-limit" type="number" min={0} value={form.monthly_limit} onChange={(e) => setForm({ ...form, monthly_limit: e.target.value })} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="sim-handset">Handset (office asset, optional)</Label>
                <Select value={form.handset_asset_id || NONE} onValueChange={(v) => setForm({ ...form, handset_asset_id: v === NONE ? "" : v })}>
                  <SelectTrigger id="sim-handset"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {handsets.map((h) => <SelectItem key={h.id} value={h.id}>{h.asset_code} · {h.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="sim-iccid">ICCID</Label>
                <Input id="sim-iccid" value={form.iccid} onChange={(e) => setForm({ ...form, iccid: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sim-puk">PUK</Label>
                <Input id="sim-puk" value={form.puk} onChange={(e) => setForm({ ...form, puk: e.target.value })} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="sim-remarks">Remarks</Label>
                <Textarea id="sim-remarks" rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Switch id="sim-active" checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                <Label htmlFor="sim-active">Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>{saveMutation.isPending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Issue / return / status */}
        <Dialog open={Boolean(moveSimRow)} onOpenChange={(o) => { if (!o) setMoveSimRow(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {move.movement_type === "issue" ? "Issue SIM" : move.movement_type === "return" ? "Take SIM back" : "Change status"}
                {moveSimRow ? ` · ${moveSimRow.sim_number}` : ""}
              </DialogTitle>
            </DialogHeader>
            {moveSimRow && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {moveSimRow.network}{moveSimRow.package_name ? ` · ${moveSimRow.package_name}` : ""} · limit PKR {fmtMoney(moveSimRow.monthly_limit)}
                  {moveSimRow.holder ? ` · with ${employeeLabel(moveSimRow.holder)}` : ""}
                </p>
                {move.movement_type === "issue" && (
                  <div className="space-y-1">
                    <Label>Employee</Label>
                    <SearchableSelect value={move.to_employee_id} onValueChange={(v) => setMove({ ...move, to_employee_id: v })}
                      options={employeeOptions} placeholder="Choose the employee…" />
                  </div>
                )}
                {move.movement_type === "status" && (
                  <div className="space-y-1">
                    <Label htmlFor="sim-new-status">New status</Label>
                    <Select value={move.new_status} onValueChange={(v) => setMove({ ...move, new_status: v })}>
                      <SelectTrigger id="sim-new-status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="suspended">Suspended</SelectItem>
                        <SelectItem value="lost">Lost</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                        <SelectItem value="in_stock">{moveSimRow.status === "suspended" && moveSimRow.holder_employee_id ? "Active again (same holder)" : "In stock"}</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Lost and closed take the SIM away from its holder.</p>
                  </div>
                )}
                <div className="space-y-1">
                  <Label htmlFor="sim-move-date">Date</Label>
                  <Input id="sim-move-date" type="date" value={move.movement_date} max={todayPk()} onChange={(e) => setMove({ ...move, movement_date: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sim-move-remarks">Remarks{move.movement_type === "status" && (move.new_status === "lost" || move.new_status === "closed") ? " (required)" : ""}</Label>
                  <Textarea id="sim-move-remarks" rows={2} value={move.remarks} onChange={(e) => setMove({ ...move, remarks: e.target.value })} />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setMoveSimRow(null)}>Cancel</Button>
              <Button onClick={() => moveMutation.mutate()} disabled={moveMutation.isPending || (move.movement_type === "issue" && !move.to_employee_id)}>
                {moveMutation.isPending ? "Saving…" : move.movement_type === "issue" ? "Issue" : move.movement_type === "return" ? "Take back" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: "warn" }) {
  return (
    <Card className={cn(tone === "warn" && "border-l-4 border-l-amber-500")}>
      <CardContent className="p-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
      </CardContent>
    </Card>
  );
}
