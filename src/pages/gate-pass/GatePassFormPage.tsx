import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { CheckCircle2, DoorOpen, FileClock, Loader2, Plus, Trash2 } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
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
import { cn } from "@/lib/utils";
import { GoodsLinesEditor } from "@/components/gate-pass/GoodsLinesEditor";
import { ScrapLinesEditor } from "@/components/gate-pass/ScrapLinesEditor";
import { BackfillFields } from "@/components/gate-pass/BackfillFields";
import {
  backfillPayload, emptyBackfill, goodsLinesPayload, newGoodsLine, newScrapLine, scrapLinesPayload,
  type BackfillState, type GoodsKind, type GoodsLine, type ScrapLine,
} from "@/lib/gatePassForms";
import {
  PASS_SELECT, PASS_TYPES, errorMessage, fmtQty, gpDb, sortedItems, type GatePass, type GatePassType,
} from "@/lib/gatePass";
import { useDispatchStorePasses } from "@/lib/storePass";

type OrderRef = { order_number: string; status: string; customers: { name: string } | null } | null;
type DispatchRow = {
  id: string;
  dispatch_number: string;
  dispatch_date: string;
  vehicle_number: string | null;
  driver_name: string | null;
  driver_contact: string | null;
  transporter_name: string | null;
  sales_orders: OrderRef;
  sales_dispatch_orders: { sales_orders: OrderRef }[];
  sales_dispatch_items: {
    id: string;
    quantity_dozens: number;
    packages: number | null;
    packing_type: string | null;
    sales_order_items: { products: { code: string; name: string } | null } | null;
  }[];
};

type ReturnRow = {
  id: string;
  return_number: string | null;
  return_date: string;
  status: string;
  suppliers: { name: string } | null;
  purchase_return_items: { quantity: number; description: string | null; items: { code: string; name: string } | null }[];
};

type SampleLine = { key: string; product_id: string; description: string; uom: string; quantity: string };

const NOT_APPROVED = ["draft", "pending", "cancelled"];

// Who a pass can go to, by type (the first is the default).
const PARTY_KINDS: Partial<Record<GatePassType, { value: string; label: string }[]>> = {
  sample: [{ value: "customer", label: "Customer" }, { value: "distributor", label: "Distributor" }, { value: "other", label: "Someone else" }],
  returnable: [{ value: "supplier", label: "Supplier / vendor" }, { value: "other", label: "Someone else" }],
  job_work: [{ value: "supplier", label: "Supplier / vendor" }, { value: "other", label: "Someone else" }],
  scrap: [{ value: "other", label: "Scrap buyer (name)" }, { value: "customer", label: "Customer" }, { value: "supplier", label: "Supplier" }],
};
const partyLabel = (kind: string) =>
  kind === "customer" ? "Customer" : kind === "distributor" ? "Distributor" : kind === "supplier" ? "Supplier / vendor" : "Name";
const newLine = (): SampleLine => ({ key: crypto.randomUUID(), product_id: "", description: "", uom: "pcs", quantity: "" });

const dispatchOrders = (d: DispatchRow) => {
  const list = [d.sales_orders, ...d.sales_dispatch_orders.map((o) => o.sales_orders)].filter(
    (o): o is NonNullable<OrderRef> => Boolean(o),
  );
  return list.filter((o, i) => list.findIndex((x) => x.order_number === o.order_number) === i);
};

export default function GatePassFormPage() {
  const { id: editId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasModulePermission } = useAuth();
  const canCreate = hasModulePermission("gate_pass", "create");

  const [passType, setPassType] = useState<GatePassType>("sales");
  const [passDate, setPassDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [vehicle, setVehicle] = useState("");
  const [driver, setDriver] = useState("");
  const [driverContact, setDriverContact] = useState("");
  const [transporter, setTransporter] = useState("");
  const [remarks, setRemarks] = useState("");
  const [dispatchIds, setDispatchIds] = useState<string[]>([]);
  const [returnId, setReturnId] = useState("");
  const [partyKind, setPartyKind] = useState("customer");
  const [partyId, setPartyId] = useState("");
  const [partyName, setPartyName] = useState("");
  const [lines, setLines] = useState<SampleLine[]>([newLine()]);
  const [expectedReturn, setExpectedReturn] = useState("");
  const [processName, setProcessName] = useState("");
  const [goodsLines, setGoodsLines] = useState<GoodsLine[]>([newGoodsLine("machine")]);
  const [scrapLines, setScrapLines] = useState<ScrapLine[]>([newScrapLine()]);
  const [backfillOn, setBackfillOn] = useState(false);
  const [backfill, setBackfill] = useState<BackfillState>(emptyBackfill());
  const canBackfill = hasModulePermission("gate_pass", "approve") && !editId;
  const partyKinds = PARTY_KINDS[passType] ?? [];

  const chooseType = (t: GatePassType) => {
    setPassType(t);
    setPartyKind(PARTY_KINDS[t]?.[0]?.value ?? "customer");
    setPartyId("");
    if (t === "returnable") setGoodsLines([newGoodsLine("machine")]);
    if (t === "job_work") setGoodsLines([newGoodsLine("item")]);
  };

  // Editing a draft: load it once and fill the form.
  const { data: editing } = useQuery<GatePass | null>({
    queryKey: ["gate-pass", editId],
    enabled: Boolean(editId),
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_passes").select(PASS_SELECT).eq("id", editId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => {
    if (!editing) return;
    setPassType(editing.pass_type);
    setPassDate(editing.pass_date);
    setVehicle(editing.vehicle_number ?? "");
    setDriver(editing.driver_name ?? "");
    setDriverContact(editing.driver_contact ?? "");
    setTransporter(editing.transporter_name ?? "");
    setRemarks(editing.remarks ?? "");
    setDispatchIds((editing.gate_pass_dispatches ?? []).map((d) => d.dispatch_id));
    setReturnId(editing.purchase_return_id ?? "");
    setPartyKind(editing.party_kind ?? "customer");
    setPartyId(editing.party_id ?? "");
    setPartyName(editing.party_kind === "other" ? editing.party_name : "");
    setExpectedReturn(editing.expected_return_date ?? "");
    setProcessName(editing.process_name ?? "");
    if (editing.pass_type === "returnable" || editing.pass_type === "job_work") {
      setGoodsLines(sortedItems(editing).map((i) => {
        const kind: GoodsKind = i.machine_id ? "machine" : i.fixed_asset_id ? "fixed_asset" : i.spare_part_id ? "spare_part"
          : i.item_id ? "item" : i.product_id ? "product" : "other";
        return {
          key: i.id, kind,
          ref_id: i.machine_id ?? i.fixed_asset_id ?? i.spare_part_id ?? i.item_id ?? i.product_id ?? "",
          description: kind === "other" ? i.description : "", uom: kind === "other" || kind === "product" ? i.uom : "",
          quantity: String(i.quantity),
          output_kind: i.expected_output_product_id ? "product" : i.expected_output_item_id ? "item" : "other",
          output_ref_id: i.expected_output_product_id ?? i.expected_output_item_id ?? "",
          output_description: i.expected_output_product_id || i.expected_output_item_id ? "" : i.expected_output_description ?? "",
        };
      }));
    }
    if (editing.pass_type === "scrap") {
      gpDb.from("gate_pass_scrap_rates").select("scrap_category_id, rate").eq("gate_pass_id", editing.id)
        .then(({ data }: { data: { scrap_category_id: string; rate: number }[] | null }) => {
          setScrapLines(sortedItems(editing).map((i) => ({
            key: i.id, scrap_category_id: i.scrap_category_id ?? "", quantity: String(i.estimated_quantity ?? i.quantity),
            rate: String(data?.find((r) => r.scrap_category_id === i.scrap_category_id)?.rate ?? ""),
          })));
        });
    }
    if (editing.pass_type === "sample") {
      setLines(sortedItems(editing).map((i) => ({
        key: i.id, product_id: i.product_id ?? "", description: i.product_id ? "" : i.description,
        uom: i.uom, quantity: String(i.quantity),
      })));
    }
  }, [editing]);

  // Dispatches already on a live pass (other than the one being edited).
  const { data: taken = [] } = useQuery<{ dispatch_id: string; gate_pass_id: string; pass_number: string }[]>({
    queryKey: ["dispatch-gate-pass"],
    queryFn: async () => {
      const { data, error } = await gpDb.from("v_dispatch_gate_pass").select("dispatch_id, gate_pass_id, pass_number");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: dispatches = [], isLoading: dispatchesLoading } = useQuery<DispatchRow[]>({
    queryKey: ["gate-pass-dispatch-candidates"],
    enabled: passType === "sales",
    queryFn: async () => {
      const { data, error } = await gpDb
        .from("sales_dispatches")
        .select(
          "id, dispatch_number, dispatch_date, vehicle_number, driver_name, driver_contact, transporter_name," +
          "sales_orders(order_number, status, customers(name))," +
          "sales_dispatch_orders(sales_orders(order_number, status, customers(name)))," +
          "sales_dispatch_items(id, quantity_dozens, packages, packing_type, sales_order_items(products(code, name)))",
        )
        .eq("delivery_status", "pending")
        .order("dispatch_date", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: returns = [] } = useQuery<ReturnRow[]>({
    queryKey: ["gate-pass-return-candidates"],
    enabled: passType === "supplier_return",
    queryFn: async () => {
      const { data, error } = await gpDb
        .from("purchase_returns")
        .select("id, return_number, return_date, status, suppliers(name), purchase_return_items(quantity, description, items(code, name))")
        .neq("status", "cancelled")
        .order("return_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: returnsTaken = [] } = useQuery<{ id: string; purchase_return_id: string; pass_number: string }[]>({
    queryKey: ["gate-pass-returns-taken"],
    enabled: passType === "supplier_return",
    queryFn: async () => {
      const { data, error } = await gpDb
        .from("gate_passes")
        .select("id, purchase_return_id, pass_number")
        .not("purchase_return_id", "is", null)
        .not("status", "in", "(cancelled,rejected)");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: customers = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["gate-pass-customers"],
    enabled: partyKind === "customer" && passType !== "sales",
    queryFn: async () => {
      const { data, error } = await gpDb.from("customers").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: distributors = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["gate-pass-distributors"],
    enabled: partyKind === "distributor",
    queryFn: async () => {
      const { data, error } = await gpDb.from("distributors").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: suppliers = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["gate-pass-suppliers"],
    enabled: partyKind === "supplier" && passType !== "supplier_return",
    queryFn: async () => {
      const { data, error } = await gpDb.from("suppliers").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const partyOptions = partyKind === "customer" ? customers : partyKind === "distributor" ? distributors : suppliers;
  const { data: products = [] } = useQuery<{ id: string; code: string; name: string }[]>({
    queryKey: ["gate-pass-products"],
    enabled: passType === "sample",
    queryFn: async () => {
      const { data, error } = await gpDb.from("products").select("id, code, name").eq("is_active", true).order("code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const takenBy = useMemo(() => {
    const m = new Map<string, string>();
    taken.filter((t) => t.gate_pass_id !== editId).forEach((t) => m.set(t.dispatch_id, t.pass_number));
    return m;
  }, [taken, editId]);

  // Store pass of each candidate dispatch (Store Pass module): shown so the office
  // sees whether the store has handed the goods over yet. Informational only.
  const storePasses = useDispatchStorePasses(passType === "sales" ? dispatches.map((d) => d.id) : []);

  const selectedDispatches = dispatches.filter((d) => dispatchIds.includes(d.id));
  const salesLines = selectedDispatches.flatMap((d) =>
    d.sales_dispatch_items
      .filter((i) => Number(i.quantity_dozens) > 0)
      .map((i) => ({
        key: i.id,
        from: d.dispatch_number,
        product: i.sales_order_items?.products ? `${i.sales_order_items.products.code} · ${i.sales_order_items.products.name}` : "Item",
        packing: i.packing_type,
        qty: Number(i.quantity_dozens),
        packages: i.packages,
      })),
  );

  const toggleDispatch = (d: DispatchRow, on: boolean) => {
    setDispatchIds((prev) => (on ? [...prev, d.id] : prev.filter((x) => x !== d.id)));
    // First dispatch picked fills in the vehicle details if they are still empty.
    if (on && !vehicle && d.vehicle_number) setVehicle(d.vehicle_number);
    if (on && !driver && d.driver_name) setDriver(d.driver_name);
    if (on && !driverContact && d.driver_contact) setDriverContact(d.driver_contact);
    if (on && !transporter && d.transporter_name) setTransporter(d.transporter_name);
  };

  const selectedReturn = returns.find((r) => r.id === returnId);
  const typeMeta = PASS_TYPES.find((t) => t.value === passType)!;

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      const data: Record<string, unknown> = {
        pass_type: passType,
        pass_date: passDate,
        vehicle_number: vehicle,
        driver_name: driver,
        driver_contact: driverContact,
        transporter_name: transporter,
        remarks,
      };
      if (passType === "sales") data.dispatch_ids = dispatchIds;
      if (passType === "supplier_return") data.purchase_return_id = returnId;
      if (partyKinds.length) {
        data.party_kind = partyKind;
        data.party_id = partyKind === "other" ? null : partyId;
        data.party_name = partyName;
      }
      if (passType === "returnable" || passType === "job_work") {
        data.expected_return_date = expectedReturn;
        data.process_name = processName;
        data.lines = goodsLinesPayload(goodsLines);
      }
      if (passType === "scrap") data.lines = scrapLinesPayload(scrapLines);
      if (backfillOn && canBackfill) data.backfill = backfillPayload(backfill);
      if (passType === "sample") {
        data.lines = lines
          .filter((l) => l.product_id || l.description.trim() || l.quantity)
          .map((l) => ({
            product_id: l.product_id || null,
            description: l.description,
            uom: l.uom,
            quantity: l.quantity,
          }));
      }
      const { data: id, error } = await gpDb.rpc("gate_pass_save", { p_id: editId ?? null, p_data: data, p_submit: submit });
      if (error) throw error;
      return { id: id as string, submit: submit || (backfillOn && canBackfill) };
    },
    onSuccess: ({ id, submit }) => {
      queryClient.invalidateQueries({ queryKey: ["gate-passes"] });
      queryClient.invalidateQueries({ queryKey: ["gate-passes-live"] });
      queryClient.invalidateQueries({ queryKey: ["gate-pass", id] });
      queryClient.invalidateQueries({ queryKey: ["dispatch-gate-pass"] });
      toast({
        title: backfillOn && canBackfill ? "Backfill saved" : submit ? "Gate pass created" : "Draft saved",
        description: backfillOn && canBackfill
          ? "Recorded as out on the paper date."
          : submit
            ? typeMeta.approval === "Approved automatically" ? "Approved automatically — ready to print." : "Sent to a manager for approval."
            : undefined,
      });
      navigate(`/gate-pass/passes/${id}`);
    },
    onError: (e) => toast({ title: "Could not save", description: errorMessage(e), variant: "destructive" }),
  });

  if (!canCreate) {
    return (
      <ERPLayout>
        <div className="p-8 text-center text-muted-foreground">You do not have permission to make gate passes.</div>
      </ERPLayout>
    );
  }
  if (editId && editing && editing.status !== "draft") {
    return (
      <ERPLayout>
        <div className="p-8 text-center text-muted-foreground">
          {editing.pass_number} is no longer a draft and cannot be edited. <Link className="text-primary underline" to={`/gate-pass/passes/${editId}`}>Open it</Link>
        </div>
      </ERPLayout>
    );
  }

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title={editing ? `Edit ${editing.pass_number}` : "New gate pass"}
          description="Goods leaving the factory. The GP number is given when you save."
          icon={DoorOpen}
        />

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">1. What is leaving?</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {PASS_TYPES.map((t) => {
              const selected = passType === t.value;
              const locked = !t.available || (Boolean(editId) && !selected);
              return (
                <button
                  key={t.value}
                  type="button"
                  disabled={locked}
                  onClick={() => chooseType(t.value)}
                  className={cn(
                    "text-left rounded-xl border p-3 transition-colors flex flex-col gap-1 min-h-[112px]",
                    selected ? "border-primary ring-2 ring-primary bg-primary/5" : "hover:bg-muted/50",
                    locked && !selected && "opacity-50 cursor-not-allowed hover:bg-transparent",
                  )}
                >
                  <span className="font-semibold">{t.label}</span>
                  <span className="text-xs text-muted-foreground leading-snug">{t.description}</span>
                  <span className={cn("text-[11px] font-semibold mt-auto",
                    t.approval === "Approved automatically" ? "text-emerald-700" : t.available ? "text-amber-700" : "text-muted-foreground")}>
                    {t.approval}
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
          <div className="space-y-4 min-w-0">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">2. Vehicle and driver</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div>
                  <Label htmlFor="gp-date">Date</Label>
                  <Input id="gp-date" type="date" value={passDate} onChange={(e) => setPassDate(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="gp-vehicle">Vehicle no.{passType === "sales" ? " *" : ""}</Label>
                  <Input id="gp-vehicle" value={vehicle} placeholder={passType === "sales" ? "e.g. LES-4471" : "Blank = hand carry / courier"} onChange={(e) => setVehicle(e.target.value.toUpperCase())} />
                </div>
                <div>
                  <Label htmlFor="gp-driver">Driver name</Label>
                  <Input id="gp-driver" value={driver} onChange={(e) => setDriver(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="gp-contact">Driver phone / CNIC</Label>
                  <Input id="gp-contact" value={driverContact} onChange={(e) => setDriverContact(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="gp-transporter">Transporter</Label>
                  <Input id="gp-transporter" value={transporter} onChange={(e) => setTransporter(e.target.value)} />
                </div>
              </CardContent>
            </Card>

            {passType === "sales" && (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">3. Dispatches loading on this vehicle</CardTitle>
                    <p className="text-sm text-muted-foreground">Pending dispatches of approved sales orders. A dispatch already on another pass cannot be picked.</p>
                  </CardHeader>
                  <CardContent className="p-0 overflow-x-auto">
                    <Table className="min-w-[760px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10" />
                          <TableHead>Dispatch</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Orders</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead className="text-right">Qty (dz)</TableHead>
                          <TableHead>Store pass</TableHead>
                          <TableHead>Note</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dispatchesLoading ? (
                          <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                        ) : dispatches.length === 0 ? (
                          <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">No pending dispatches.</TableCell></TableRow>
                        ) : dispatches.map((d) => {
                          const orders = dispatchOrders(d);
                          const unapproved = orders.filter((o) => NOT_APPROVED.includes(o.status));
                          const onPass = takenBy.get(d.id);
                          const disabled = Boolean(onPass) || unapproved.length > 0 || orders.length === 0;
                          const checked = dispatchIds.includes(d.id);
                          const qty = d.sales_dispatch_items.reduce((s, i) => s + Number(i.quantity_dozens), 0);
                          return (
                            <TableRow key={d.id} className={cn(disabled && !checked && "opacity-60")}>
                              <TableCell>
                                <Checkbox
                                  aria-label={`Select ${d.dispatch_number}`}
                                  checked={checked}
                                  disabled={disabled && !checked}
                                  onCheckedChange={(v) => toggleDispatch(d, v === true)}
                                />
                              </TableCell>
                              <TableCell className="font-mono text-sm font-semibold">{d.dispatch_number}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{format(new Date(d.dispatch_date), "dd MMM")}</TableCell>
                              <TableCell className="text-sm">{orders.map((o) => o.order_number).join(", ") || "—"}</TableCell>
                              <TableCell className="text-sm max-w-[220px] truncate">
                                {[...new Set(orders.map((o) => o.customers?.name).filter(Boolean))].join("; ")}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{fmtQty(qty)}</TableCell>
                              <TableCell className="text-xs whitespace-nowrap">
                                {(() => {
                                  const sp = storePasses.get(d.id);
                                  if (!sp) return <span className="text-amber-700 font-medium">No store pass</span>;
                                  return <span className={cn("font-mono", sp.status === "issued" ? "text-emerald-700" : "text-muted-foreground")}>{sp.pass_number}{sp.status === "issued" && sp.issued_at ? ` · ${format(new Date(sp.issued_at), "HH:mm")}` : " · draft"}</span>;
                                })()}
                              </TableCell>
                              <TableCell className="text-xs">
                                {onPass ? <span className="text-red-700 font-medium">On {onPass}</span>
                                  : unapproved.length ? <span className="text-red-700 font-medium">Order not approved</span>
                                  : <span className="text-emerald-700 font-medium">Ready</span>}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">4. Lines on the pass</CardTitle>
                    <p className="text-sm text-muted-foreground">Taken from the dispatches. The guard counts cartons where a line has them. No prices are printed.</p>
                  </CardHeader>
                  <CardContent className="p-0 overflow-x-auto">
                    <Table className="min-w-[640px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead>Packing</TableHead>
                          <TableHead>From</TableHead>
                          <TableHead className="text-right">Qty (dz)</TableHead>
                          <TableHead className="text-right">Cartons</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {salesLines.length === 0 ? (
                          <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Select dispatches above.</TableCell></TableRow>
                        ) : salesLines.map((l) => (
                          <TableRow key={l.key}>
                            <TableCell className="font-medium">{l.product}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{l.packing || "—"}</TableCell>
                            <TableCell className="text-sm font-mono">{l.from}</TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">{fmtQty(l.qty)}</TableCell>
                            <TableCell className="text-right tabular-nums">{l.packages ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </>
            )}

            {passType === "supplier_return" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">3. Purchase return</CardTitle>
                  <p className="text-sm text-muted-foreground">The rejected material goes back on this return. Stock was already taken out by the return itself.</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Select value={returnId} onValueChange={setReturnId}>
                    <SelectTrigger className="max-w-xl"><SelectValue placeholder="Select a purchase return" /></SelectTrigger>
                    <SelectContent>
                      {returns.map((r) => {
                        const onPass = returnsTaken.find((t) => t.purchase_return_id === r.id && t.id !== editId);
                        return (
                          <SelectItem key={r.id} value={r.id} disabled={Boolean(onPass)}>
                            {r.return_number ?? "Return"} · {r.suppliers?.name ?? "Supplier"} · {format(new Date(r.return_date), "dd MMM")} · {r.status}
                            {onPass ? ` (on ${onPass.pass_number})` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {selectedReturn && (
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedReturn.purchase_return_items.map((i, n) => (
                          <TableRow key={n}>
                            <TableCell>{i.items ? `${i.items.code} · ${i.items.name}` : i.description}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtQty(i.quantity)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            )}

            {partyKinds.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">3. {passType === "scrap" ? "Buyer" : passType === "sample" ? "Going to" : "Vendor / repairer"}</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-3">
                  <div>
                    <Label>Party type</Label>
                    <Select value={partyKind} onValueChange={(v) => { setPartyKind(v); setPartyId(""); }}>
                      <SelectTrigger aria-label="Party type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {partyKinds.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="gp-party">{partyLabel(partyKind)}</Label>
                    {partyKind === "other" ? (
                      <Input id="gp-party" value={partyName} placeholder="Person or company" onChange={(e) => setPartyName(e.target.value)} />
                    ) : (
                      <Select value={partyId || undefined} onValueChange={setPartyId}>
                        <SelectTrigger id="gp-party"><SelectValue placeholder="Select…" /></SelectTrigger>
                        <SelectContent>
                          {partyOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  {(passType === "returnable" || passType === "job_work") && (
                    <>
                      <div>
                        <Label htmlFor="gp-due">Due back on *</Label>
                        <Input id="gp-due" type="date" value={expectedReturn} min={passDate} onChange={(e) => setExpectedReturn(e.target.value)} />
                      </div>
                      {passType === "job_work" ? (
                        <div>
                          <Label htmlFor="gp-process">Process *</Label>
                          <Input id="gp-process" value={processName} placeholder="e.g. Printing, Cutting" onChange={(e) => setProcessName(e.target.value)} />
                        </div>
                      ) : <div />}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {(passType === "returnable" || passType === "job_work") && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">4. {passType === "returnable" ? "Going out for repair / loan" : "Material sent for job work"}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {passType === "returnable"
                      ? "Store items and products move to “Out for repair”; spare parts leave spare-part stock. They come back through a receipt."
                      : "The material moves to “At job work” when the vehicle leaves. Each receipt uses it up there and receives the processed item."}
                  </p>
                </CardHeader>
                <CardContent>
                  <GoodsLinesEditor type={passType} lines={goodsLines} setLines={setGoodsLines} />
                </CardContent>
              </Card>
            )}

            {passType === "scrap" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">4. Scrap going out</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {backfillOn ? "Enter the weights on the paper pass." : "Enter the expected weight — the guard weighs the truck at the gate and the real net weight is used. Rates are for this sale only and are never shown to the guard."}
                  </p>
                </CardHeader>
                <CardContent>
                  <ScrapLinesEditor lines={scrapLines} setLines={setScrapLines} weightLabel={backfillOn ? "Weight on paper" : "Expected weight"} />
                </CardContent>
              </Card>
            )}

            {canBackfill && (
              <Card className={cn(backfillOn && "border-amber-300")}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Checkbox id="gp-backfill" checked={backfillOn} onCheckedChange={(v) => setBackfillOn(v === true)} />
                    <Label htmlFor="gp-backfill" className="text-base font-semibold flex items-center gap-2 cursor-pointer">
                      <FileClock className="h-4 w-4" /> Manual backfill of a paper pass (managers only)
                    </Label>
                  </div>
                  {backfillOn && (
                    <p className="text-sm text-muted-foreground">The goods already left on a paper pass. Saving records the pass as Out on the paper date, with the same stock effects.</p>
                  )}
                </CardHeader>
                {backfillOn && (
                  <CardContent>
                    <BackfillFields value={backfill} onChange={setBackfill} />
                  </CardContent>
                )}
              </Card>
            )}

            {passType === "sample" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">4. Samples</CardTitle>
                  <p className="text-sm text-muted-foreground">Finished-goods lines are taken out of stock when the vehicle leaves. Anything else is written as free text.</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    {lines.map((l, idx) => (
                      <div key={l.key} className="grid grid-cols-1 md:grid-cols-[1fr_110px_120px_40px] gap-2 items-end">
                        <div>
                          {idx === 0 && <Label>Product (or type a description)</Label>}
                          <div className="flex gap-2">
                            <Select
                              value={l.product_id || "none"}
                              onValueChange={(v) => setLines((ls) => ls.map((x) => x.key === l.key
                                ? { ...x, product_id: v === "none" ? "" : v, uom: v === "none" ? x.uom : (x.uom === "dz" ? "dz" : "pcs") }
                                : x))}
                            >
                              <SelectTrigger className="w-[260px] shrink-0" aria-label={`Line ${idx + 1} product`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Not a product (free text)</SelectItem>
                                {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} · {p.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            {!l.product_id && (
                              <Input aria-label={`Line ${idx + 1} description`} placeholder="Description" value={l.description}
                                onChange={(e) => setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, description: e.target.value } : x))} />
                            )}
                          </div>
                        </div>
                        <div>
                          {idx === 0 && <Label>Qty</Label>}
                          <Input aria-label={`Line ${idx + 1} quantity`} type="number" min="0" step="any" value={l.quantity}
                            onChange={(e) => setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, quantity: e.target.value } : x))} />
                        </div>
                        <div>
                          {idx === 0 && <Label>Unit</Label>}
                          {l.product_id ? (
                            <Select value={l.uom} onValueChange={(v) => setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, uom: v } : x))}>
                              <SelectTrigger aria-label={`Line ${idx + 1} unit`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pcs">pcs</SelectItem>
                                <SelectItem value="dz">dz</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input aria-label={`Line ${idx + 1} unit`} value={l.uom}
                              onChange={(e) => setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, uom: e.target.value } : x))} />
                          )}
                        </div>
                        <Button variant="ghost" size="icon" aria-label={`Remove line ${idx + 1}`} disabled={lines.length === 1}
                          onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
                      <Plus className="h-4 w-4 mr-1" /> Add line
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Summary</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">GP number</span><span className="font-medium">{editing?.pass_number ?? "Given on save"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="font-medium">{typeMeta.label}</span></div>
                {passType === "sales" && (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">Dispatches</span><span className="font-medium">{dispatchIds.length}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Total</span>
                      <span className="font-medium">{fmtQty(salesLines.reduce((s, l) => s + l.qty, 0))} dz · {salesLines.reduce((s, l) => s + Number(l.packages || 0), 0)} ctn</span></div>
                  </>
                )}
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Stock</span>
                  <span className="font-medium text-right">{{
                    sample: "Finished goods issued at gate",
                    returnable: "Moves to “Out for repair”",
                    job_work: "Moves to “At job work”",
                    scrap: "Out of the Scrap Yard, by weight",
                  }[passType as string] ?? "No movement (already done)"}</span></div>
              </CardContent>
            </Card>

            <div className={cn("rounded-xl border p-4 flex gap-3",
              typeMeta.approval === "Approved automatically" ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200")}>
              <CheckCircle2 className={cn("h-5 w-5 shrink-0", typeMeta.approval === "Approved automatically" ? "text-emerald-700" : "text-amber-700")} />
              <div className="text-sm">
                <div className="font-semibold">{typeMeta.approval}</div>
                <div className="text-muted-foreground">
                  {passType === "sales" ? "The sales orders are already approved, so the pass goes straight to the gate."
                    : passType === "supplier_return" ? "The purchase return is the approval, so the pass goes straight to the gate."
                    : backfillOn && canBackfill ? "Entered by a manager, so it is approved and recorded as out straight away."
                    : "A gate pass manager must approve before the guard can let it out."}
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="gp-remarks">{passType === "sample" ? "Reason for the samples *" : passType === "returnable" ? "Fault / reason" : "Remarks"}</Label>
              <Textarea id="gp-remarks" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>

            <div className="flex flex-col gap-2">
              <Button disabled={save.isPending} onClick={() => save.mutate(true)}>
                {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {backfillOn && canBackfill ? "Save backfill (recorded as out)"
                  : typeMeta.approval === "Approved automatically" ? "Create pass" : "Create and send for approval"}
              </Button>
              {!(backfillOn && canBackfill) && (
                <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(false)}>Save as draft</Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </ERPLayout>
  );
}
