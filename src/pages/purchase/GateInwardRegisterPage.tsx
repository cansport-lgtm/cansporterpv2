import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { format, subDays } from "date-fns";
import { FileSpreadsheet, Plus, Printer, Search, Settings2, Truck } from "lucide-react";
import * as XLSX from "xlsx";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { errorMessage, todayPk } from "@/lib/gatePass";
import { esc, printDocument } from "@/lib/printDocument";
import {
  DEFAULT_SETTINGS, INWARD_KINDS, INWARD_STATUS, canInwardGate, fmtInAt, giDb, inwardClosingRef, inwardReference,
  inwardStatusMeta, kindMeta, type InwardEntry, type InwardKind, type InwardSettings,
} from "@/lib/gateInward";

const CATEGORIES = [
  { value: "raw_material", label: "Raw material" },
  { value: "office_supplies", label: "Office supplies" },
  { value: "general_supplies", label: "General supplies" },
  { value: "spare_maintenance", label: "Spare & maintenance" },
];

export default function GateInwardRegisterPage() {
  const navigate = useNavigate();
  const { roles } = useAuth();
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const canMake = canInwardGate(roles);
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 6), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [kindFilter, setKindFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading } = useQuery<InwardEntry[]>({
    queryKey: ["gate-inward", "register", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await giDb
        .from("v_gate_inward_register")
        .select("*")
        .gte("entry_date", fromDate)
        .lte("entry_date", toDate)
        .order("in_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Everything still at the gate, whatever the date range.
  const { data: atGate = [] } = useQuery<InwardEntry[]>({
    queryKey: ["gate-inward", "at-gate"],
    queryFn: async () => {
      const { data, error } = await giDb.from("v_gate_inward_register").select("*").eq("status", "at_gate").order("in_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) =>
      (kindFilter === "all" || r.entry_kind === kindFilter) &&
      (statusFilter === "all" || r.status === statusFilter) &&
      (!q || [r.entry_number, r.party_name, r.vehicle_number, r.driver_name ?? "", r.challan_number ?? "", inwardReference(r), inwardClosingRef(r)]
        .some((v) => v.toLowerCase().includes(q))),
    );
  }, [rows, kindFilter, statusFilter, search]);

  const today = todayPk();
  const weekAgo = format(subDays(new Date(), 7), "yyyy-MM-dd");
  const kpis = [
    { label: "At gate today", value: atGate.filter((r) => r.entry_date === today).length, tone: "text-amber-700" },
    { label: "Awaiting receipt (all days)", value: atGate.length, tone: atGate.some((r) => r.is_stale) ? "text-red-700" : "", hint: atGate.filter((r) => r.is_stale).length ? `${atGate.filter((r) => r.is_stale).length} stale` : "" },
    { label: "Received today", value: rows.filter((r) => ["grn_made", "received", "closed", "loaded_out"].includes(r.status) && (r.closed_at ?? "").slice(0, 10) === today).length, tone: "text-emerald-700" },
    { label: "Rejected (7 days)", value: rows.filter((r) => r.status === "rejected" && (r.rejected_at ?? "") >= weekAgo).length, tone: "text-red-700" },
  ];

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map((r) => ({
      "GIN no.": r.entry_number,
      Date: r.entry_date,
      "In at": format(new Date(r.in_at), "HH:mm"),
      Type: kindMeta(r.entry_kind).label,
      From: r.party_name,
      Reference: inwardReference(r),
      Vehicle: r.vehicle_number,
      Driver: r.driver_name ?? "",
      Transporter: r.transporter_name ?? "",
      Challan: r.challan_number ?? "",
      Packages: r.packages_count ?? "",
      "Gross kg": r.gross_weight_kg ?? "",
      Status: inwardStatusMeta(r.status).label,
      "Closed by": inwardClosingRef(r),
      "Vehicle left": r.vehicle_out_at ? format(new Date(r.vehicle_out_at), "yyyy-MM-dd HH:mm") : "",
      "Recorded by": r.created_by_name ?? "",
      Remarks: r.remarks ?? "",
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inward register");
    XLSX.writeFile(wb, `Inward-Register-${fromDate}${fromDate === toDate ? "" : `_to_${toDate}`}.xlsx`);
  };

  const printRegister = () => {
    const rowsHtml = filtered.map((r, i) => `<tr>
      <td>${i + 1}</td><td class="bold">${esc(r.entry_number)}</td>
      <td>${esc(format(new Date(r.in_at), "dd MMM HH:mm"))}</td>
      <td>${esc(kindMeta(r.entry_kind).label)}</td>
      <td>${esc(r.party_name)}<div class="xs muted">${esc(inwardReference(r))}</div></td>
      <td>${esc(r.vehicle_number)}<div class="xs muted">${esc(r.driver_name ?? "")}</div></td>
      <td>${esc(r.challan_number ?? "")}</td>
      <td class="num">${r.packages_count ?? ""}</td>
      <td>${esc(inwardStatusMeta(r.status).label)}<div class="xs muted">${esc(inwardClosingRef(r))}</div></td>
      <td>${r.vehicle_out_at ? esc(format(new Date(r.vehicle_out_at), "dd MMM HH:mm")) : ""}</td>
    </tr>`).join("");
    printDocument(`Inward register ${fromDate}`, `
      <div class="wrap">
        <div class="head"><div><h1>Inward Gate Register</h1><div class="xs muted">${esc(fromDate)}${fromDate === toDate ? "" : ` to ${esc(toDate)}`} · ${filtered.length} entries</div></div></div>
        <table><thead><tr><th>#</th><th>GIN</th><th>In</th><th>Type</th><th>From / ref</th><th>Vehicle</th><th>Challan</th><th class="num">Pkgs</th><th>Status</th><th>Left</th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="10" class="muted">No entries.</td></tr>`}</tbody></table>
      </div>`);
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Gate Inward Register" description="Every vehicle that brought goods in — recorded at the gate before the store receives it" icon={Truck}>
          <Button variant="outline" onClick={printRegister} disabled={filtered.length === 0}><Printer className="h-4 w-4 mr-1" /> Print</Button>
          <Button variant="outline" onClick={exportExcel} disabled={filtered.length === 0}><FileSpreadsheet className="h-4 w-4 mr-1" /> Export</Button>
          {canMake && (
            <Button onClick={() => navigate("/gate-pass/inward/new")}><Plus className="h-4 w-4 mr-1" /> New inward entry</Button>
          )}
        </PageHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpis.map((k) => (
            <Card key={k.label}>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">{k.label}</div>
                <div className={cn("text-2xl font-display font-bold mt-1", k.tone)}>{k.value}</div>
                {k.hint && <div className="text-xs text-red-700">{k.hint}</div>}
              </CardContent>
            </Card>
          ))}
        </div>

        {atGate.length > 0 && (
          <Card className="border-amber-200">
            <CardHeader className="pb-2"><CardTitle className="text-base">At the gate now — not yet received</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>GIN no.</TableHead><TableHead>In at</TableHead><TableHead>Type</TableHead><TableHead>From</TableHead>
                    <TableHead>Reference</TableHead><TableHead>Vehicle</TableHead><TableHead>Waiting</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {atGate.map((r) => (
                    <TableRow key={r.id} className={cn("cursor-pointer", r.is_stale && "bg-red-50")} onClick={() => navigate(`/purchase/gate-inward/${r.id}`)}>
                      <TableCell className="font-mono text-sm font-semibold">{r.entry_number}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{fmtInAt(r.in_at)}</TableCell>
                      <TableCell><span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap", kindMeta(r.entry_kind).badgeClass)}>{kindMeta(r.entry_kind).label}</span></TableCell>
                      <TableCell className="max-w-[220px] truncate" title={r.party_name}>{r.party_name}</TableCell>
                      <TableCell className="font-mono text-sm">{inwardReference(r) || "—"}</TableCell>
                      <TableCell className="text-sm">{r.vehicle_number}{r.vehicle_out_at ? <span className="text-xs text-muted-foreground"> · left</span> : ""}</TableCell>
                      <TableCell className={cn("text-sm font-semibold", r.is_stale ? "text-red-700" : "")}>{r.age_days === 0 ? "today" : `${r.age_days} day${r.age_days === 1 ? "" : "s"}`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-3 md:p-4 flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" className="w-40" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" className="w-40" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={kindFilter} onValueChange={setKindFilter}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {INWARD_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {Object.entries(INWARD_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs" htmlFor="gi-search">Search</Label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input id="gi-search" className="pl-8" placeholder="GIN no., supplier, PO, pass, vehicle, challan…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table className="min-w-[1050px]">
              <TableHeader>
                <TableRow>
                  <TableHead>GIN no.</TableHead>
                  <TableHead>In at</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Vehicle · driver</TableHead>
                  <TableHead>Challan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Vehicle left</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No inward entries in this range.</TableCell></TableRow>
                ) : filtered.map((r) => {
                  const k = kindMeta(r.entry_kind);
                  const s = inwardStatusMeta(r.status);
                  return (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/purchase/gate-inward/${r.id}`)}>
                      <TableCell className="font-mono text-sm font-semibold">
                        <Link to={`/purchase/gate-inward/${r.id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{r.entry_number}</Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{fmtInAt(r.in_at)}</TableCell>
                      <TableCell><span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap", k.badgeClass)}>{k.label}</span></TableCell>
                      <TableCell className="max-w-[220px] truncate" title={r.party_name}>{r.party_name}</TableCell>
                      <TableCell className="font-mono text-sm">{inwardReference(r) || "—"}</TableCell>
                      <TableCell className="text-sm">{r.vehicle_number}{r.driver_name ? <div className="text-xs text-muted-foreground">{r.driver_name}</div> : null}</TableCell>
                      <TableCell className="text-sm">{r.challan_number || "—"}{r.packages_count != null ? <div className="text-xs text-muted-foreground">{r.packages_count} pkg</div> : null}</TableCell>
                      <TableCell>
                        <Badge variant={s.variant}>{s.label}</Badge>
                        {inwardClosingRef(r) && <div className="text-xs text-muted-foreground mt-1 font-mono">{inwardClosingRef(r)}</div>}
                        {r.status === "at_gate" && r.is_stale && <div className="text-xs text-red-700 mt-1">{r.age_days} days at gate</div>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{r.vehicle_out_at ? format(new Date(r.vehicle_out_at), "dd MMM HH:mm") : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {isSuperAdmin && <SettingsCard />}
      </div>
    </ERPLayout>
  );
}

/** Super admin: the Gate Inward settings row. */
function SettingsCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: settings = DEFAULT_SETTINGS } = useQuery<InwardSettings>({
    queryKey: ["gate-inward-settings"],
    queryFn: async () => {
      const { data, error } = await giDb.from("gate_inward_settings").select("*").maybeSingle();
      if (error) throw error;
      return data ?? DEFAULT_SETTINGS;
    },
  });
  const save = useMutation({
    mutationFn: async (patch: Partial<InwardSettings>) => {
      const { error } = await giDb.rpc("gate_inward_settings_save", { p: patch });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Settings saved" }); queryClient.invalidateQueries({ queryKey: ["gate-inward-settings"] }); },
    onError: (e) => toast({ title: "Could not save", description: errorMessage(e), variant: "destructive" }),
  });
  const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Settings2 className="h-4 w-4" /> Gate Inward settings (super admin)</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">No GRN without a gate inward entry</div>
              <div className="text-xs text-muted-foreground">When on, a GRN in the categories below must name the gate entry. Off until the gate is trained.</div>
            </div>
            <Switch checked={settings.require_for_grn} onCheckedChange={(v) => save.mutate({ require_for_grn: v })} />
          </div>
          <div className={cn("space-y-1 pl-1", !settings.require_for_grn && "opacity-60")}>
            <div className="text-xs font-medium">Required for</div>
            {CATEGORIES.map((c) => (
              <label key={c.value} className="flex items-center gap-2">
                <Checkbox checked={settings.require_for_categories.includes(c.value)}
                  onCheckedChange={() => save.mutate({ require_for_categories: toggleIn(settings.require_for_categories, c.value) })} />
                {c.label}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="gi-stale" className="shrink-0">Stale after (days at gate)</Label>
            <Input id="gi-stale" type="number" min={1} className="w-24" defaultValue={settings.stale_days} key={settings.stale_days}
              onBlur={(e) => { const n = parseInt(e.target.value, 10); if (n >= 1 && n !== settings.stale_days) save.mutate({ stale_days: n }); }} />
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <div className="font-medium">Purchase orders the guard can pick</div>
            <div className="text-xs text-muted-foreground">Categories of PO offered on the gate's Purchase entry.</div>
            <div className="space-y-1 pl-1 mt-1">
              {CATEGORIES.map((c) => (
                <label key={c.value} className="flex items-center gap-2">
                  <Checkbox checked={settings.purchase_categories.includes(c.value)}
                    onCheckedChange={() => save.mutate({ purchase_categories: toggleIn(settings.purchase_categories, c.value) })} />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="font-medium">Inward types the guard can pick</div>
            <div className="space-y-1 pl-1 mt-1">
              {INWARD_KINDS.map((k) => (
                <label key={k.value} className="flex items-center gap-2">
                  <Checkbox checked={settings.enabled_kinds.includes(k.value)}
                    onCheckedChange={() => save.mutate({ enabled_kinds: toggleIn(settings.enabled_kinds, k.value) as InwardKind[] })} />
                  {k.label}
                  {["sales_return", "sample", "loading_vehicle", "other"].includes(k.value) && <span className="text-xs text-muted-foreground">· closed by the office for now</span>}
                </label>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
