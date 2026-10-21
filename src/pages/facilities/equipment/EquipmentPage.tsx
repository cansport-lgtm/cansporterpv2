import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Loader2, Pencil, Plus, Wrench } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, facilitiesCan, fcDb, fmtDate, fmtQty, rpc } from "@/lib/facilities";
import {
  AMC_META, DUE_META, EQUIPMENT_STATUS_LABEL, loadEquipmentDue, loadEquipmentTypes,
  type Equipment, type EquipmentType,
} from "@/lib/facilitiesEquipment";

type Tab = "all" | "due" | "amc";

type FormState = {
  code: string; name: string; type_id: string; location: string; fixed_asset_id: string;
  vendor_name: string; amc_vendor_name: string; amc_start: string; amc_expiry: string;
  service_interval_days: string; service_interval_hours: string; last_service_date: string;
  run_hours: string; last_service_hours: string; status: Equipment["status"]; remarks: string; is_active: boolean;
};

const emptyForm = (): FormState => ({
  code: "", name: "", type_id: "", location: "", fixed_asset_id: "", vendor_name: "", amc_vendor_name: "",
  amc_start: "", amc_expiry: "", service_interval_days: "", service_interval_hours: "", last_service_date: "",
  run_hours: "0", last_service_hours: "", status: "active", remarks: "", is_active: true,
});

const NONE = "__none__";

/** Admin & Facilities → the office equipment register: AMC, service intervals, next due. */
export default function EquipmentPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles } = useAuth();
  const canManage = facilitiesCan(roles, "manage");
  const canOperate = facilitiesCan(roles, "operate");

  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const { data: types = [] } = useQuery<EquipmentType[]>({ queryKey: ["facilities-equipment-types"], queryFn: loadEquipmentTypes });
  const { data: equipment = [], isLoading } = useQuery<Equipment[]>({ queryKey: ["facilities-equipment-due"], queryFn: loadEquipmentDue });
  const { data: assets = [] } = useQuery<{ id: string; asset_code: string; name: string }[]>({
    queryKey: ["facilities-office-assets-for-equipment"],
    enabled: dialogOpen && canManage,
    queryFn: async () => {
      const { data, error } = await fcDb.from("fixed_assets").select("id, asset_code, name")
        .eq("category", "office_assets").neq("status", "disposed").order("asset_code").limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return equipment.filter((e) => {
      if (tab === "due" && !(e.due_state === "overdue" || e.due_state === "due_soon")) return false;
      if (tab === "amc" && (e.amc_state === "none" || !e.amc_expiry)) return false;
      if (typeFilter !== "all" && e.type_id !== typeFilter) return false;
      if (!q) return true;
      return [e.code, e.name, e.location, e.vendor_name, e.amc_vendor_name, e.type_name]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [equipment, tab, typeFilter, search]);

  const dueCount = equipment.filter((e) => e.due_state === "overdue" || e.due_state === "due_soon").length;
  const amcCount = equipment.filter((e) => e.amc_state === "expiring" || e.amc_state === "expired").length;

  const openNew = () => { setEditingId(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = (e: Equipment) => {
    setEditingId(e.id);
    setForm({
      code: e.code, name: e.name, type_id: e.type_id, location: e.location ?? "", fixed_asset_id: e.fixed_asset_id ?? "",
      vendor_name: e.vendor_name ?? "", amc_vendor_name: e.amc_vendor_name ?? "", amc_start: e.amc_start ?? "",
      amc_expiry: e.amc_expiry ?? "", service_interval_days: e.service_interval_days?.toString() ?? "",
      service_interval_hours: e.service_interval_hours?.toString() ?? "", last_service_date: e.last_service_date ?? "",
      run_hours: String(e.run_hours ?? 0), last_service_hours: e.last_service_hours?.toString() ?? "",
      status: e.status, remarks: e.remarks ?? "", is_active: e.is_active,
    });
    setDialogOpen(true);
  };

  const save = useMutation({
    mutationFn: () => rpc<string>("facilities_equipment_save", { p_id: editingId, p_data: { ...form, fixed_asset_id: form.fixed_asset_id || null } }),
    onSuccess: () => {
      toast({ title: editingId ? "Equipment updated" : "Equipment added" });
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["facilities-equipment-due"] });
    },
    onError: (e) => toast({ title: "Not saved", description: errorMessage(e), variant: "destructive" }),
  });

  const serviceTicket = useMutation({
    mutationFn: (equipmentId: string) => rpc<string>("facilities_service_ticket_create", { p_equipment_id: equipmentId }),
    onSuccess: (id) => {
      toast({ title: "Service ticket created" });
      queryClient.invalidateQueries({ queryKey: ["facilities-tickets"] });
      navigate(`/facilities/equipment/tickets/${id}`);
    },
    onError: (e) => toast({ title: "Ticket not created", description: errorMessage(e), variant: "destructive" }),
  });

  const selectedType = types.find((t) => t.id === form.type_id);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Office Equipment" description="ACs, generators, UPS, printers, extinguishers, lift — vendors, AMC and service intervals" icon={Wrench}>
          <Button variant="outline" onClick={() => navigate("/facilities/equipment/tickets")}>Tickets</Button>
          {canManage && (
            <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Add equipment</Button>
          )}
        </PageHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="all">All ({equipment.length})</TabsTrigger>
            <TabsTrigger value="due">Service due{dueCount ? ` (${dueCount})` : ""}</TabsTrigger>
            <TabsTrigger value="amc">AMC contracts{amcCount ? ` (${amcCount})` : ""}</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input placeholder="Search code, name, location, vendor" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="sm:w-56"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipment</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Vendor / AMC</TableHead>
                  <TableHead>Interval</TableHead>
                  <TableHead>Last service</TableHead>
                  <TableHead>Next due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    {equipment.length === 0 ? "No equipment yet. Add the ACs, generator, UPS, printers and extinguishers." : "Nothing matches."}
                  </TableCell></TableRow>
                ) : rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <div className="font-medium">{e.code}</div>
                      <div className="text-sm text-muted-foreground">{e.name}</div>
                    </TableCell>
                    <TableCell>{e.type_name}</TableCell>
                    <TableCell>{e.location ?? "—"}</TableCell>
                    <TableCell>
                      <div className="text-sm">{e.amc_vendor_name ?? e.vendor_name ?? "—"}</div>
                      {e.amc_expiry && (
                        <div className="mt-1 flex items-center gap-1 text-xs">
                          <Badge variant={AMC_META[e.amc_state ?? "none"].variant}>{AMC_META[e.amc_state ?? "none"].label}</Badge>
                          <span className="text-muted-foreground">to {fmtDate(e.amc_expiry)}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {e.interval_days ? `${e.interval_days} days` : e.interval_hours ? `${e.interval_hours} run hours` : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {e.interval_hours ? `${fmtQty(e.last_service_hours ?? 0)} h (now ${fmtQty(e.run_hours)} h)` : fmtDate(e.last_service_date)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={DUE_META[e.due_state ?? "none"].variant} className="w-fit">{DUE_META[e.due_state ?? "none"].label}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {e.next_due_date ? fmtDate(e.next_due_date) : e.hours_to_service != null ? `${fmtQty(e.hours_to_service)} h left` : ""}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{EQUIPMENT_STATUS_LABEL[e.status] ?? e.status}{!e.is_active ? " · inactive" : ""}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {canOperate && e.status === "active" && (
                        <Button size="sm" variant="outline" className="mr-1" disabled={serviceTicket.isPending}
                          onClick={() => serviceTicket.mutate(e.id)}>Service ticket</Button>
                      )}
                      {canManage && (
                        <Button size="icon" variant="ghost" onClick={() => openEdit(e)} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit equipment" : "Add equipment"}</DialogTitle>
            <DialogDescription>The type gives the default service interval and checklist; an interval set here overrides it.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1"><Label htmlFor="eq-code">Code</Label><Input id="eq-code" value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="EQ-001" /></div>
            <div className="space-y-1"><Label htmlFor="eq-name">Name</Label><Input id="eq-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Generator 100 kVA" /></div>
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={form.type_id} onValueChange={(v) => set("type_id", v)}>
                <SelectTrigger><SelectValue placeholder="Choose type" /></SelectTrigger>
                <SelectContent>{types.filter((t) => t.is_active || t.id === form.type_id).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
              {selectedType && (selectedType.service_interval_days || selectedType.service_interval_hours) && (
                <p className="text-xs text-muted-foreground">Default: every {selectedType.service_interval_days ? `${selectedType.service_interval_days} days` : `${selectedType.service_interval_hours} run hours`}</p>
              )}
            </div>
            <div className="space-y-1"><Label htmlFor="eq-loc">Location</Label><Input id="eq-loc" value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Accounts office" /></div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Fixed asset (optional)</Label>
              <Select value={form.fixed_asset_id || NONE} onValueChange={(v) => set("fixed_asset_id", v === NONE ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.asset_code} · {a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label htmlFor="eq-vendor">Vendor</Label><Input id="eq-vendor" value={form.vendor_name} onChange={(e) => set("vendor_name", e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="eq-amc-vendor">AMC vendor</Label><Input id="eq-amc-vendor" value={form.amc_vendor_name} onChange={(e) => set("amc_vendor_name", e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="eq-amc-start">AMC start</Label><Input id="eq-amc-start" type="date" value={form.amc_start} onChange={(e) => set("amc_start", e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="eq-amc-expiry">AMC expiry</Label><Input id="eq-amc-expiry" type="date" value={form.amc_expiry} onChange={(e) => set("amc_expiry", e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="eq-int-days">Service every (days)</Label><Input id="eq-int-days" type="number" min={1} value={form.service_interval_days} onChange={(e) => set("service_interval_days", e.target.value)} placeholder="type default" /></div>
            <div className="space-y-1"><Label htmlFor="eq-int-hours">Service every (run hours)</Label><Input id="eq-int-hours" type="number" min={1} value={form.service_interval_hours} onChange={(e) => set("service_interval_hours", e.target.value)} placeholder="type default" /></div>
            <div className="space-y-1"><Label htmlFor="eq-last">Last service date</Label><Input id="eq-last" type="date" value={form.last_service_date} onChange={(e) => set("last_service_date", e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="eq-run">Run hours now</Label><Input id="eq-run" type="number" min={0} step="0.1" value={form.run_hours} onChange={(e) => set("run_hours", e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="eq-last-h">Run hours at last service</Label><Input id="eq-last-h" type="number" min={0} step="0.1" value={form.last_service_hours} onChange={(e) => set("last_service_hours", e.target.value)} /></div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as Equipment["status"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="out_of_service">Out of service</SelectItem>
                  <SelectItem value="retired">Retired</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="eq-remarks">Remarks</Label><Textarea id="eq-remarks" rows={2} value={form.remarks} onChange={(e) => set("remarks", e.target.value)} /></div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch id="eq-active" checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} />
              <Label htmlFor="eq-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
