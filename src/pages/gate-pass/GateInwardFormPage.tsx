import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { Html5Qrcode } from "html5-qrcode";
import { ArrowLeft, Camera, CheckCircle2, Loader2, Search, Truck } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { GuardShell } from "@/components/gate-pass/GuardShell";
import { useGuardOnly } from "@/hooks/useGuardOnly";
import { PhotoInput } from "@/components/gate-pass/PhotoInput";
import { errorMessage, normalizePassNumber } from "@/lib/gatePass";
import {
  DEFAULT_SETTINGS, INWARD_KINDS, canInwardGate, canInwardOffice, giDb, kindMeta,
  type InwardEntry, type InwardKind, type InwardSettings,
} from "@/lib/gateInward";

const SCANNER_ID = "gate-inward-pass-scanner";

type SupplierOpt = { id: string; name: string; code: string | null; open_po_count: number };
type OpenPO = { id: string; po_number: string; order_date: string; expected_date: string | null; category: string; status: string; at_gate_count: number };
type OpenPass = {
  id: string; pass_number: string; pass_type: string; status: string; party_name: string;
  vehicle_number: string | null; driver_name: string | null; process_name: string | null;
  expected_return_date: string | null; gate_out_at: string | null; at_gate_count: number;
};

type Form = {
  entry_kind: InwardKind | "";
  supplier_id: string;
  purchase_order_id: string;
  gate_pass_id: string;
  customer_id: string;
  party_name: string;
  vehicle_number: string;
  driver_name: string;
  driver_contact: string;
  transporter_name: string;
  challan_number: string;
  challan_date: string;
  packages_count: string;
  gross_weight_kg: string;
  challan_photo_path: string;
  vehicle_photo_path: string;
  remarks: string;
};

const EMPTY: Form = {
  entry_kind: "", supplier_id: "", purchase_order_id: "", gate_pass_id: "", customer_id: "", party_name: "",
  vehicle_number: "", driver_name: "", driver_contact: "", transporter_name: "", challan_number: "", challan_date: "",
  packages_count: "", gross_weight_kg: "", challan_photo_path: "", vehicle_photo_path: "", remarks: "",
};

const VEHICLE_FIELDS: (keyof Form)[] = ["vehicle_number", "driver_name", "driver_contact", "transporter_name", "vehicle_photo_path"];
// The gate guard only records goods coming back on an old pass: scan it, take a
// photo, save. Purchase and the other types are recorded by the office.
const GUARD_KINDS: InwardKind[] = ["returnable_return", "job_work_return"];

export default function GateInwardFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles } = useAuth();
  const guardOnly = useGuardOnly();
  const canMake = canInwardGate(roles) || canInwardOffice(roles);
  const [form, setForm] = useState<Form>(EMPTY);
  const [passSearch, setPassSearch] = useState("");
  const [passQuery, setPassQuery] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [saved, setSaved] = useState<{ id: string; number: string } | null>(null);
  const [showMore, setShowMore] = useState(false);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const { data: settings = DEFAULT_SETTINGS } = useQuery<InwardSettings>({
    queryKey: ["gate-inward-settings"],
    queryFn: async () => {
      const { data, error } = await giDb.from("gate_inward_settings").select("*").maybeSingle();
      if (error) throw error;
      return data ?? DEFAULT_SETTINGS;
    },
  });

  // Editing: load the entry (only while it is at the gate).
  const { data: existing } = useQuery<InwardEntry | null>({
    queryKey: ["gate-inward", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await giDb.from("v_gate_inward_register").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => {
    if (!existing) return;
    setForm({
      entry_kind: existing.entry_kind,
      supplier_id: existing.supplier_id ?? "",
      purchase_order_id: existing.purchase_order_id ?? "",
      gate_pass_id: existing.gate_pass_id ?? "",
      customer_id: existing.customer_id ?? "",
      party_name: existing.party_name ?? "",
      vehicle_number: existing.vehicle_number ?? "",
      driver_name: existing.driver_name ?? "",
      driver_contact: existing.driver_contact ?? "",
      transporter_name: existing.transporter_name ?? "",
      challan_number: existing.challan_number ?? "",
      challan_date: existing.challan_date ?? "",
      packages_count: existing.packages_count?.toString() ?? "",
      gross_weight_kg: existing.gross_weight_kg?.toString() ?? "",
      challan_photo_path: existing.challan_photo_path ?? "",
      vehicle_photo_path: existing.vehicle_photo_path ?? "",
      remarks: existing.remarks ?? "",
    });
    if (existing.pass_number) setPassQuery(existing.pass_number);
  }, [existing]);

  const kind = form.entry_kind;
  const isPurchase = kind === "purchase";
  const isPassReturn = kind === "returnable_return" || kind === "job_work_return";
  const wantedPassType = kind === "returnable_return" ? "returnable" : "job_work";

  const { data: suppliers = [] } = useQuery<SupplierOpt[]>({
    queryKey: ["gate-inward-suppliers"],
    enabled: isPurchase,
    queryFn: async () => {
      const { data, error } = await giDb.rpc("gate_inward_suppliers");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: allSuppliers = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["gate-inward-all-suppliers"],
    enabled: kind === "sample" || kind === "other",
    queryFn: async () => {
      const { data, error } = await giDb.from("suppliers").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: customers = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["gate-inward-customers"],
    enabled: kind === "sales_return" || kind === "loading_vehicle",
    queryFn: async () => {
      const { data, error } = await giDb.from("customers").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: openPOs = [], isFetching: posLoading } = useQuery<OpenPO[]>({
    queryKey: ["gate-inward-open-pos", form.supplier_id],
    enabled: isPurchase && Boolean(form.supplier_id),
    queryFn: async () => {
      const { data, error } = await giDb.rpc("gate_inward_open_pos", { p_supplier_id: form.supplier_id });
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: openPasses = [], isFetching: passesLoading } = useQuery<OpenPass[]>({
    queryKey: ["gate-inward-open-passes", passQuery],
    enabled: isPassReturn && passQuery !== null,
    queryFn: async () => {
      const { data, error } = await giDb.rpc("gate_inward_open_passes", { p_search: passQuery });
      if (error) throw error;
      return data ?? [];
    },
  });
  const passes = useMemo(() => openPasses.filter((p) => p.pass_type === wantedPassType), [openPasses, wantedPassType]);
  const chosenPass = passes.find((p) => p.id === form.gate_pass_id) ?? openPasses.find((p) => p.id === form.gate_pass_id);

  const searchPasses = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const q = /^(gp-?)?\d+$/i.test(text) || /^https?:/i.test(text) ? normalizePassNumber(text) : text;
    setPassSearch(q);
    setPassQuery(q);
  };

  const stopScanner = () => {
    scannerRef.current?.stop().catch(() => {});
    scannerRef.current = null;
    setScanning(false);
  };
  const startScanner = async () => {
    setScanning(true);
    await new Promise((r) => setTimeout(r, 50));
    try {
      const scanner = new Html5Qrcode(SCANNER_ID);
      scannerRef.current = scanner;
      await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 240, height: 240 } },
        (text) => { stopScanner(); searchPasses(text); }, () => {});
    } catch {
      toast({ title: "Camera not available", description: "Type the GP number instead.", variant: "destructive" });
      setScanning(false);
    }
  };
  useEffect(() => () => { scannerRef.current?.stop().catch(() => {}); }, []);

  // Pick one pass automatically when the search hits exactly one.
  useEffect(() => {
    if (isPassReturn && passes.length === 1 && !form.gate_pass_id) set("gate_pass_id", passes[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passes]);

  const enabledKinds = INWARD_KINDS.filter((k) =>
    settings.enabled_kinds.includes(k.value) && (!guardOnly || GUARD_KINDS.includes(k.value)));

  // A pass was chosen: start from the vehicle it went out on (the guard changes it if different).
  useEffect(() => {
    if (chosenPass && !form.vehicle_number) set("vehicle_number", (chosenPass.vehicle_number ?? "").toUpperCase() || "HAND CARRY");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenPass?.id]);

  const save = useMutation({
    mutationFn: async (mode: "done" | "another") => {
      const { data, error } = await giDb.rpc("gate_inward_save", { p_id: id ?? null, p_data: { ...form } });
      if (error) throw error;
      const { data: row } = await giDb.from("gate_inward_entries").select("entry_number").eq("id", data).maybeSingle();
      return { id: data as string, number: (row?.entry_number as string) ?? "", mode };
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["gate-inward"] });
      queryClient.invalidateQueries({ queryKey: ["gate-inward-open-pos"] });
      queryClient.invalidateQueries({ queryKey: ["gate-inward-open-passes"] });
      if (r.mode === "another") {
        toast({ title: `${r.number} saved`, description: "Now the next entry for the same vehicle." });
        setSaved({ id: r.id, number: r.number });
        setForm((f) => {
          const next = { ...EMPTY };
          VEHICLE_FIELDS.forEach((k) => { (next as Record<string, string>)[k] = f[k] as string; });
          return next;
        });
        setPassQuery(null); setPassSearch("");
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        toast({ title: id ? "Entry updated" : `${r.number} saved` });
        navigate(`/gate-pass/inward/${r.id}`, { replace: Boolean(id) });
      }
    },
    onError: (e) => toast({ title: "Could not save", description: errorMessage(e), variant: "destructive" }),
  });

  const title = id ? "Edit Inward Entry" : "New Inward Entry";
  const Shell = ({ children }: { children: React.ReactNode }) =>
    guardOnly ? <GuardShell title={title}>{children}</GuardShell> : <ERPLayout>{children}</ERPLayout>;

  if (!canMake) {
    return <Shell><div className="p-8 text-center text-muted-foreground">Only gate security, a gate pass manager or the purchase office can make inward entries.</div></Shell>;
  }
  if (id && existing && existing.status !== "at_gate") {
    return (
      <Shell>
        <div className="p-8 text-center text-muted-foreground space-y-3">
          <div>{existing.entry_number} is no longer at the gate and cannot be edited.</div>
          <Button variant="outline" asChild><Link to={`/gate-pass/inward/${existing.id}`}>Open the entry</Link></Button>
        </div>
      </Shell>
    );
  }

  const refChosen = isPurchase ? Boolean(form.purchase_order_id)
    : isPassReturn ? Boolean(form.gate_pass_id)
    : kind === "sales_return" || kind === "loading_vehicle" ? Boolean(form.customer_id || form.party_name.trim())
    : kind ? Boolean(form.supplier_id || form.party_name.trim()) : false;
  const canSave = Boolean(kind) && refChosen && form.vehicle_number.trim().length > 0 && !save.isPending;

  return (
    <Shell>
      <div className={cn("space-y-3", !guardOnly && "max-w-3xl")}>
        {guardOnly ? (
          <Link to="/gate-pass/check" className="text-sm text-primary inline-flex items-center gap-1"><ArrowLeft className="h-4 w-4" /> Gate Check</Link>
        ) : (
          <>
            <Link to={canInwardOffice(roles) && !canInwardGate(roles) ? "/purchase/gate-inward" : "/gate-pass/check"} className="text-sm text-primary inline-flex items-center gap-1">
              <ArrowLeft className="h-4 w-4" /> Back
            </Link>
            <PageHeader title={title} description="Record the vehicle before it is unloaded. The store counts the goods on the GRN or receipt." icon={Truck} />
          </>
        )}

        {saved && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-700 shrink-0" />
            <div className="flex-1">{saved.number} saved. Vehicle details kept for the next entry.</div>
            <Button size="sm" variant="outline" asChild><Link to={`/gate-pass/inward/${saved.id}`}>Open</Link></Button>
          </div>
        )}

        {/* 1. Type */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{guardOnly ? "What is coming back?" : "What is coming in?"}</CardTitle></CardHeader>
          <CardContent className={cn("grid grid-cols-1 gap-2", guardOnly ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
            {enabledKinds.map((k) => (
              <button key={k.value} type="button" disabled={Boolean(id)}
                aria-pressed={kind === k.value}
                className={cn("rounded-xl border-2 p-3 text-left transition-colors disabled:opacity-60",
                  kind === k.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}
                onClick={() => setForm((f) => ({ ...EMPTY, ...Object.fromEntries(VEHICLE_FIELDS.map((v) => [v, f[v]])), entry_kind: k.value }))}>
                <div className="font-semibold">{k.label}</div>
                <div className="text-xs text-muted-foreground">{k.description}</div>
              </button>
            ))}
            {enabledKinds.length === 0 && <div className="text-sm text-muted-foreground">No inward types are enabled. Ask a super admin.</div>}
            {guardOnly && <div className="sm:col-span-2 text-xs text-muted-foreground">Supplier deliveries (purchase) are recorded by the purchase office.</div>}
          </CardContent>
        </Card>

        {/* 2. Against what */}
        {isPurchase && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Supplier and purchase order</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>Supplier *</Label>
                <SearchableSelect
                  value={form.supplier_id}
                  onValueChange={(v) => setForm((f) => ({ ...f, supplier_id: v, purchase_order_id: "" }))}
                  placeholder="Choose the supplier"
                  options={suppliers.map((s) => ({ value: s.id, label: s.name, secondary: s.code ? `· ${s.code}` : undefined, search: s.code ?? "" }))}
                />
                <div className="text-xs text-muted-foreground">Only suppliers with an open order in: {settings.purchase_categories.map((c) => c.replace(/_/g, " ")).join(", ")}.</div>
              </div>
              {form.supplier_id && (
                <div className="space-y-2">
                  <Label>Purchase order *</Label>
                  {posLoading && <div className="text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-1" />Loading…</div>}
                  {!posLoading && openPOs.length === 0 && <div className="text-sm text-amber-800">This supplier has no open order that can receive goods. Call the purchase office.</div>}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {openPOs.map((po) => (
                      <button key={po.id} type="button" aria-pressed={form.purchase_order_id === po.id}
                        className={cn("rounded-xl border-2 p-3 text-left", form.purchase_order_id === po.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}
                        onClick={() => set("purchase_order_id", po.id)}>
                        <div className="font-mono font-semibold">{po.po_number}</div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(po.order_date), "dd MMM yyyy")} · {po.category.replace(/_/g, " ")} · {po.status.replace(/_/g, " ")}
                        </div>
                        {po.at_gate_count > 0 && <div className="text-xs text-amber-700 mt-1">{po.at_gate_count} vehicle(s) already at the gate for this PO</div>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isPassReturn && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Which gate pass did these go out on?</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); searchPasses(passSearch); }}>
                <Input value={passSearch} placeholder="GP number, e.g. 131 — or the party's name" className="h-12"
                  onChange={(e) => setPassSearch(e.target.value)} />
                <Button type="submit" className="h-12 px-4"><Search className="h-4 w-4" /></Button>
              </form>
              {scanning ? (
                <div className="space-y-2">
                  <div id={SCANNER_ID} className="w-full overflow-hidden rounded-lg" />
                  <Button type="button" variant="outline" className="w-full h-11" onClick={stopScanner}>Stop camera</Button>
                </div>
              ) : (
                <Button type="button" variant="secondary" className="w-full h-11" onClick={startScanner}>
                  <Camera className="h-5 w-5 mr-2" /> Scan the QR on the old pass
                </Button>
              )}
              {passesLoading && <div className="text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-1" />Looking…</div>}
              {passQuery !== null && !passesLoading && passes.length === 0 && (
                <div className="text-sm text-amber-800">
                  No {kindMeta(kind).label.toLowerCase().replace(" back", "")} pass still outside matches "{passQuery}".
                  {openPasses.length > 0 && " A pass of another type matched — check the type above."}
                </div>
              )}
              <div className="space-y-2">
                {passes.map((p) => (
                  <button key={p.id} type="button" aria-pressed={form.gate_pass_id === p.id}
                    className={cn("w-full rounded-xl border-2 p-3 text-left", form.gate_pass_id === p.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}
                    onClick={() => set("gate_pass_id", p.id)}>
                    <div className="flex justify-between gap-2">
                      <span className="font-mono font-semibold">{p.pass_number}</span>
                      <span className="text-xs text-muted-foreground">{p.status.replace(/_/g, " ")}</span>
                    </div>
                    <div className="text-sm">{p.party_name}{p.process_name ? ` · ${p.process_name}` : ""}</div>
                    <div className="text-xs text-muted-foreground">
                      Went out {p.gate_out_at ? format(new Date(p.gate_out_at), "dd MMM yyyy") : "—"}
                      {p.expected_return_date ? ` · due back ${format(new Date(p.expected_return_date), "dd MMM yyyy")}` : ""}
                      {p.vehicle_number ? ` · went out on ${p.vehicle_number}` : ""}
                    </div>
                    {p.at_gate_count > 0 && <div className="text-xs text-amber-700 mt-1">{p.at_gate_count} vehicle(s) already at the gate for this pass</div>}
                  </button>
                ))}
                {chosenPass && !passes.some((p) => p.id === chosenPass.id) && (
                  <div className="rounded-xl border-2 border-primary bg-primary/5 p-3 text-sm">
                    <span className="font-mono font-semibold">{chosenPass.pass_number}</span> · {chosenPass.party_name}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {(kind === "sales_return" || kind === "loading_vehicle") && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{kind === "sales_return" ? "Customer" : "Who has the vehicle come for?"}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <SearchableSelect value={form.customer_id} onValueChange={(v) => set("customer_id", v)} placeholder="Choose the customer"
                options={customers.map((c) => ({ value: c.id, label: c.name }))} />
              {kind === "loading_vehicle" && (
                <div className="space-y-1">
                  <Label htmlFor="gi-party">Or transporter / party name</Label>
                  <Input id="gi-party" value={form.party_name} onChange={(e) => set("party_name", e.target.value)} />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {(kind === "sample" || kind === "other") && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Who is it from?</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <SearchableSelect value={form.supplier_id} onValueChange={(v) => set("supplier_id", v)} placeholder="Supplier (if any)"
                options={allSuppliers.map((s) => ({ value: s.id, label: s.name }))} />
              <div className="space-y-1">
                <Label htmlFor="gi-party2">Or name *</Label>
                <Input id="gi-party2" value={form.party_name} onChange={(e) => set("party_name", e.target.value)} placeholder="Courier company, person, firm…" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* 3. Vehicle and documents */}
        {kind && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{guardOnly ? "Vehicle and photo" : "Vehicle and papers"}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {chosenPass?.vehicle_number && (
                <div className="text-xs text-muted-foreground">Went out on <b>{chosenPass.vehicle_number}</b>{chosenPass.driver_name ? ` · driver ${chosenPass.driver_name}` : ""}. Change it if a different vehicle came.</div>
              )}
              <div className="space-y-1">
                <Label htmlFor="gi-vehicle" className="font-semibold">Vehicle number *</Label>
                <Input id="gi-vehicle" value={form.vehicle_number} className="h-12 text-lg uppercase" placeholder="Number plate"
                  onChange={(e) => set("vehicle_number", e.target.value.toUpperCase())} />
              </div>
              {guardOnly && (
                <div className="space-y-1">
                  <Label>Photo of the old pass and the goods</Label>
                  <PhotoInput id="gi-guard-photo" label="Take a photo" folder="inward-challan" value={form.challan_photo_path} onChange={(p) => set("challan_photo_path", p)} />
                </div>
              )}
              {guardOnly && !showMore && (
                <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setShowMore(true)}>More details (driver, packages, second photo)…</Button>
              )}
              {(!guardOnly || showMore) && (<>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="gi-driver">Driver</Label>
                  <Input id="gi-driver" value={form.driver_name} onChange={(e) => set("driver_name", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gi-contact">Driver phone</Label>
                  <Input id="gi-contact" inputMode="tel" value={form.driver_contact} onChange={(e) => set("driver_contact", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gi-transporter">Transporter</Label>
                  <Input id="gi-transporter" value={form.transporter_name} onChange={(e) => set("transporter_name", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gi-packages">Packages (as per challan)</Label>
                  <Input id="gi-packages" type="number" inputMode="numeric" min="0" value={form.packages_count} onChange={(e) => set("packages_count", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gi-challan">Challan / bilty no.</Label>
                  <Input id="gi-challan" value={form.challan_number} onChange={(e) => set("challan_number", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gi-challan-date">Challan date</Label>
                  <Input id="gi-challan-date" type="date" value={form.challan_date} onChange={(e) => set("challan_date", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gi-weight">Gross weight (kg, if weighed)</Label>
                  <Input id="gi-weight" type="number" inputMode="decimal" min="0" step="any" value={form.gross_weight_kg} onChange={(e) => set("gross_weight_kg", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {!guardOnly && (
                  <div className="space-y-1">
                    <Label>Photo of the challan</Label>
                    <PhotoInput id="gi-challan-photo" label="Photograph the challan" folder="inward-challan" value={form.challan_photo_path} onChange={(p) => set("challan_photo_path", p)} />
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Photo of the vehicle</Label>
                  <PhotoInput id="gi-vehicle-photo" label="Photograph the vehicle" folder="inward-vehicle" value={form.vehicle_photo_path} onChange={(p) => set("vehicle_photo_path", p)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="gi-remarks">Remarks</Label>
                <Textarea id="gi-remarks" rows={2} value={form.remarks} onChange={(e) => set("remarks", e.target.value)} />
              </div>
              </>)}
            </CardContent>
          </Card>
        )}

        {kind && (
          <div className="sticky bottom-0 bg-background/95 backdrop-blur py-3 space-y-2">
            <Button className="w-full h-14 text-lg font-bold" disabled={!canSave} onClick={() => save.mutate("done")}>
              {save.isPending && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}
              {id ? "Save changes" : guardOnly ? "Save entry" : "Save & print slip"}
            </Button>
            {!id && !guardOnly && (
              <Button variant="outline" className="w-full h-11" disabled={!canSave} onClick={() => save.mutate("another")}>
                Save & add another entry for the same vehicle
              </Button>
            )}
            {!canSave && !save.isPending && (
              <p className="text-xs text-center text-muted-foreground">
                {!refChosen ? (isPurchase ? "Choose the supplier and purchase order." : isPassReturn ? "Choose the gate pass." : "Say who it is from.")
                  : "Enter the vehicle number."}
              </p>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
