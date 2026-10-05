import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { Loader2, Warehouse } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PhotoInput } from "@/components/gate-pass/PhotoInput";
import { SP_SELECT, errorMessage, fmtQty, spDb, type StorePass } from "@/lib/storePass";

type OrderRef = { order_number: string; status: string; customers: { name: string } | null } | null;
type DispatchRow = {
  id: string;
  dispatch_number: string;
  dispatch_date: string;
  vehicle_number: string | null;
  driver_name: string | null;
  driver_contact: string | null;
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
type LineEdit = { quantity: string; packages: string; remarks: string };

const NOT_APPROVED = ["draft", "pending", "cancelled"];

const dispatchOrders = (d: DispatchRow) => {
  const list = [d.sales_orders, ...d.sales_dispatch_orders.map((o) => o.sales_orders)].filter(
    (o): o is NonNullable<OrderRef> => Boolean(o),
  );
  return list.filter((o, i) => list.findIndex((x) => x.order_number === o.order_number) === i);
};
const customersOf = (d: DispatchRow) =>
  [...new Set(dispatchOrders(d).map((o) => o.customers?.name).filter(Boolean))].join("; ");

export default function StorePassFormPage() {
  const { id: editId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasModulePermission } = useAuth();
  const canCreate = hasModulePermission("store_pass", "create");

  const [passDate, setPassDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [vehicle, setVehicle] = useState("");
  const [driver, setDriver] = useState("");
  const [driverContact, setDriverContact] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [storeLocation, setStoreLocation] = useState("");
  const [photoPath, setPhotoPath] = useState("");
  const [remarks, setRemarks] = useState("");
  const [dispatchIds, setDispatchIds] = useState<string[]>([]);
  // Issued figures the keeper typed, by dispatch item id. Blank = as the dispatch.
  const [edits, setEdits] = useState<Record<string, LineEdit>>({});

  // Editing a draft: load it once and fill the form.
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
    setVehicle(editing.vehicle_number ?? "");
    setDriver(editing.driver_name ?? "");
    setDriverContact(editing.driver_contact ?? "");
    setReceivedBy(editing.received_by_name ?? "");
    setStoreLocation(editing.store_location ?? "");
    setPhotoPath(editing.photo_path ?? "");
    setRemarks(editing.remarks ?? "");
    setDispatchIds((editing.store_pass_dispatches ?? []).map((d) => d.dispatch_id));
    const e: Record<string, LineEdit> = {};
    (editing.store_pass_items ?? []).forEach((i) => {
      if (i.dispatch_item_id) {
        e[i.dispatch_item_id] = {
          quantity: String(i.quantity),
          packages: i.packages === null ? "" : String(i.packages),
          remarks: i.remarks ?? "",
        };
      }
    });
    setEdits(e);
  }, [editing]);

  // Dispatches already on a live store pass (other than the one being edited).
  const { data: taken = [] } = useQuery<{ dispatch_id: string; store_pass_id: string; pass_number: string }[]>({
    queryKey: ["dispatch-store-pass"],
    queryFn: async () => {
      const { data, error } = await spDb.from("v_dispatch_store_pass").select("dispatch_id, store_pass_id, pass_number");
      if (error) throw error;
      return data ?? [];
    },
  });
  // Dispatches that already have a gate pass (the store pass is late, but still allowed while pending).
  const { data: gatePasses = [] } = useQuery<{ dispatch_id: string; pass_number: string; status: string }[]>({
    queryKey: ["dispatch-gate-pass"],
    queryFn: async () => {
      const { data, error } = await spDb.from("v_dispatch_gate_pass").select("dispatch_id, pass_number, status");
      if (error) return [];
      return data ?? [];
    },
  });

  // Pending domestic dispatches: the vehicle has not left yet.
  const { data: dispatches = [], isLoading: dispatchesLoading } = useQuery<DispatchRow[]>({
    queryKey: ["store-pass-dispatch-candidates"],
    queryFn: async () => {
      const { data, error } = await spDb
        .from("sales_dispatches")
        .select(
          "id, dispatch_number, dispatch_date, vehicle_number, driver_name, driver_contact," +
          "sales_orders(order_number, status, customers(name))," +
          "sales_dispatch_orders(sales_orders(order_number, status, customers(name)))," +
          "sales_dispatch_items(id, quantity_dozens, packages, packing_type, sales_order_items(products(code, name)))",
        )
        .eq("sales_segment", "domestic")
        .eq("delivery_status", "pending")
        .order("dispatch_date", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  const takenBy = useMemo(() => {
    const m = new Map<string, string>();
    taken.filter((t) => t.store_pass_id !== editId).forEach((t) => m.set(t.dispatch_id, t.pass_number));
    return m;
  }, [taken, editId]);
  const gpOf = useMemo(() => new Map(gatePasses.map((g) => [g.dispatch_id, g])), [gatePasses]);

  // The dispatches picked, in dispatch-number order (the pass is printed that way).
  const selected = useMemo(
    () => dispatches.filter((d) => dispatchIds.includes(d.id)).sort((a, b) => a.dispatch_number.localeCompare(b.dispatch_number)),
    [dispatches, dispatchIds],
  );
  const lines = selected.flatMap((d) =>
    d.sales_dispatch_items
      .filter((i) => Number(i.quantity_dozens) > 0)
      .map((i) => {
        const e = edits[i.id];
        const quantity = e && e.quantity !== "" ? Number(e.quantity) : Number(i.quantity_dozens);
        const packages = e && e.packages !== "" ? Number(e.packages) : i.packages === null ? null : Number(i.packages);
        return {
          key: i.id,
          dispatch: d,
          product: i.sales_order_items?.products ? `${i.sales_order_items.products.code} · ${i.sales_order_items.products.name}` : "Item",
          packing: i.packing_type,
          dcQty: Number(i.quantity_dozens),
          dcPackages: i.packages === null ? null : Number(i.packages),
          quantity,
          packages,
          remarks: e?.remarks ?? "",
          short: quantity < Number(i.quantity_dozens) || Number(packages ?? 0) < Number(i.packages ?? 0),
          over: quantity > Number(i.quantity_dozens) || Number(packages ?? 0) > Number(i.packages ?? 0),
        };
      }),
  );
  const totals = lines.reduce(
    (t, l) => ({
      quantity: t.quantity + l.quantity, packages: t.packages + Number(l.packages ?? 0),
      dcQty: t.dcQty + l.dcQty, dcPackages: t.dcPackages + Number(l.dcPackages ?? 0),
    }),
    { quantity: 0, packages: 0, dcQty: 0, dcPackages: 0 },
  );
  const shortNoRemark = lines.filter((l) => l.short && !l.remarks.trim()).length;
  const over = lines.filter((l) => l.over).length;

  const setEdit = (key: string, patch: Partial<LineEdit>) =>
    setEdits((prev) => ({ ...prev, [key]: { quantity: "", packages: "", remarks: "", ...prev[key], ...patch } }));

  const toggleDispatch = (d: DispatchRow, on: boolean) => {
    setDispatchIds((prev) => (on ? [...prev, d.id] : prev.filter((x) => x !== d.id)));
    // First dispatch picked fills in the vehicle details if they are still empty.
    if (on && !vehicle && d.vehicle_number) setVehicle(d.vehicle_number.toUpperCase());
    if (on && !driver && d.driver_name) setDriver(d.driver_name);
    if (on && !driverContact && d.driver_contact) setDriverContact(d.driver_contact);
  };

  const save = useMutation({
    mutationFn: async (issue: boolean) => {
      const data = {
        pass_date: passDate,
        vehicle_number: vehicle,
        driver_name: driver,
        driver_contact: driverContact,
        received_by_name: receivedBy,
        store_location: storeLocation,
        photo_path: photoPath,
        remarks,
        dispatch_ids: dispatchIds,
        lines: lines.map((l) => ({
          dispatch_item_id: l.key,
          quantity: l.quantity,
          packages: l.packages,
          remarks: l.remarks,
        })),
      };
      const { data: id, error } = await spDb.rpc("store_pass_save", { p_id: editId ?? null, p_data: data, p_issue: issue });
      if (error) throw error;
      return { id: id as string, issue };
    },
    onSuccess: ({ id, issue }) => {
      queryClient.invalidateQueries({ queryKey: ["store-passes"] });
      queryClient.invalidateQueries({ queryKey: ["store-pass", id] });
      queryClient.invalidateQueries({ queryKey: ["dispatch-store-pass"] });
      queryClient.invalidateQueries({ queryKey: ["store-gate-tracking"] });
      toast({
        title: issue ? "Store pass issued" : "Draft saved",
        description: issue ? "Time-stamped and ready to print. Hand it over with the goods." : undefined,
      });
      navigate(`/store-pass/passes/${id}`);
    },
    onError: (e) => toast({ title: "Could not save", description: errorMessage(e), variant: "destructive" }),
  });

  if (!canCreate) {
    return (
      <ERPLayout>
        <div className="p-8 text-center text-muted-foreground">You do not have permission to make store passes.</div>
      </ERPLayout>
    );
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
          description="Finished goods handed over by the store for one vehicle. The SP number is given when you save. No stock moves; no prices."
          icon={Warehouse}
        />

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
          <div className="space-y-4 min-w-0">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">1. Vehicle and driver</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <Label htmlFor="sp-vehicle">Vehicle no. *</Label>
                  <Input id="sp-vehicle" value={vehicle} placeholder="e.g. LES-4471" onChange={(e) => setVehicle(e.target.value.toUpperCase())} />
                </div>
                <div>
                  <Label htmlFor="sp-driver">Driver name</Label>
                  <Input id="sp-driver" value={driver} onChange={(e) => setDriver(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="sp-contact">Driver phone / CNIC</Label>
                  <Input id="sp-contact" value={driverContact} onChange={(e) => setDriverContact(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="sp-date">Date</Label>
                  <Input id="sp-date" type="date" value={passDate} onChange={(e) => setPassDate(e.target.value)} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">2. Dispatches going on this vehicle</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Pending domestic dispatches of approved sales orders. A dispatch already on another store pass cannot be picked.
                </p>
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
                      <TableHead className="text-right">Dz / Ctn</TableHead>
                      <TableHead>DC vehicle</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dispatchesLoading ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                    ) : dispatches.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">No pending domestic dispatches.</TableCell></TableRow>
                    ) : dispatches.map((d) => {
                      const orders = dispatchOrders(d);
                      const unapproved = orders.filter((o) => NOT_APPROVED.includes(o.status));
                      const onPass = takenBy.get(d.id);
                      const gp = gpOf.get(d.id);
                      const disabled = Boolean(onPass) || unapproved.length > 0 || orders.length === 0;
                      const checked = dispatchIds.includes(d.id);
                      const qty = d.sales_dispatch_items.reduce((s, i) => s + Number(i.quantity_dozens), 0);
                      const ctn = d.sales_dispatch_items.reduce((s, i) => s + Number(i.packages ?? 0), 0);
                      const sameVehicle = vehicle && d.vehicle_number && d.vehicle_number.replace(/[^A-Za-z0-9]/g, "").toUpperCase() === vehicle.replace(/[^A-Za-z0-9]/g, "");
                      return (
                        <TableRow key={d.id} className={cn(disabled && !checked && "opacity-60", checked && "bg-primary/5")}>
                          <TableCell>
                            <Checkbox
                              aria-label={`Select ${d.dispatch_number}`}
                              checked={checked}
                              disabled={disabled && !checked}
                              onCheckedChange={(v) => toggleDispatch(d, v === true)}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-sm font-semibold">{d.dispatch_number}</TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{format(new Date(d.dispatch_date), "dd MMM")}</TableCell>
                          <TableCell className="text-sm">{orders.map((o) => o.order_number).join(", ") || "—"}</TableCell>
                          <TableCell className="text-sm max-w-[220px] truncate" title={customersOf(d)}>{customersOf(d)}</TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">{fmtQty(qty)} / {ctn}</TableCell>
                          <TableCell className={cn("text-sm", sameVehicle && "font-semibold text-emerald-700")}>{d.vehicle_number || "—"}</TableCell>
                          <TableCell className="text-xs">
                            {onPass ? <span className="text-red-700 font-medium">On {onPass}</span>
                              : unapproved.length ? <span className="text-red-700 font-medium">Order not approved</span>
                              : gp ? <span className="text-amber-700 font-medium">Gate pass {gp.pass_number} already made</span>
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
                <CardTitle className="text-base">3. Lines issued from the store</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Copied from the dispatches. Confirm or correct what actually left the store. Short issue needs a remark; issuing more than the dispatch is not allowed.
                </p>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[820px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Packing</TableHead>
                      <TableHead className="text-right">DC dz</TableHead>
                      <TableHead className="text-right">DC ctn</TableHead>
                      <TableHead className="text-right bg-primary/5">Issued dz</TableHead>
                      <TableHead className="text-right bg-primary/5">Issued ctn</TableHead>
                      <TableHead>Remark</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Select dispatches above.</TableCell></TableRow>
                    ) : selected.map((d) => (
                      <GroupRows key={d.id} dispatch={d} lines={lines.filter((l) => l.dispatch.id === d.id)} setEdit={setEdit} />
                    ))}
                  </TableBody>
                  {lines.length > 0 && (
                    <tfoot>
                      <TableRow className="font-semibold">
                        <TableCell colSpan={2}>Totals</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtQty(totals.dcQty)}</TableCell>
                        <TableCell className="text-right tabular-nums">{totals.dcPackages}</TableCell>
                        <TableCell className="text-right tabular-nums text-primary">{fmtQty(totals.quantity)}</TableCell>
                        <TableCell className="text-right tabular-nums text-primary">{totals.packages}</TableCell>
                        <TableCell className="text-xs font-normal">
                          {totals.quantity === totals.dcQty && totals.packages === totals.dcPackages
                            ? <span className="text-emerald-700 font-semibold">Matches the dispatches</span>
                            : <span className="text-amber-700 font-semibold">
                                Short by {fmtQty(totals.dcQty - totals.quantity)} dz · {totals.dcPackages - totals.packages} ctn
                              </span>}
                        </TableCell>
                      </TableRow>
                    </tfoot>
                  )}
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">4. Handover</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="sp-received">Received by (loader / driver)</Label>
                  <Input id="sp-received" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="sp-location">Store location / loading bay</Label>
                  <Input id="sp-location" value={storeLocation} placeholder="e.g. FG Store A · Bay 2" onChange={(e) => setStoreLocation(e.target.value)} />
                </div>
                <div>
                  <Label>Photo of the loaded stack (optional)</Label>
                  <PhotoInput id="sp-photo" label="Take photo" folder="store-pass" value={photoPath} onChange={setPhotoPath} />
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <Label htmlFor="sp-remarks">Remarks</Label>
                  <Textarea id="sp-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Summary</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">SP number</span><span className="font-medium">{editing?.pass_number ?? "Given on save"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Vehicle</span><span className="font-medium">{vehicle || "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Dispatches</span><span className="font-medium">{dispatchIds.length}</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Customers</span>
                  <span className="font-medium text-right">{[...new Set(selected.map(customersOf).filter(Boolean))].join("; ") || "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Issued</span>
                  <span className="font-medium">{fmtQty(totals.quantity)} dz · {totals.packages} ctn</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">On dispatches</span>
                  <span className="font-medium">{fmtQty(totals.dcQty)} dz · {totals.dcPackages} ctn</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Stock</span>
                  <span className="font-medium text-right">No movement — the dispatch already did it</span></div>
              </CardContent>
            </Card>

            {(over > 0 || shortNoRemark > 0) && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-1">
                {over > 0 && <div><b>{over} line(s)</b> issue more than the dispatch. Lower them, or ask the office to correct the dispatch first.</div>}
                {shortNoRemark > 0 && <div><b>{shortNoRemark} short line(s)</b> need a remark saying why.</div>}
              </div>
            )}

            <div className="rounded-xl border p-4 bg-muted/30 text-sm text-muted-foreground">
              Issuing stamps the time and your name on the pass and freezes the lines. After issue only a store pass manager can cancel it.
              The gate guard still counts against the <b>gate pass</b>; the daily reconciliation compares the two.
            </div>

            <div className="flex flex-col gap-2">
              <Button disabled={save.isPending || dispatchIds.length === 0} onClick={() => save.mutate(true)}>
                {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Issue store pass
              </Button>
              <Button variant="outline" disabled={save.isPending || dispatchIds.length === 0} onClick={() => save.mutate(false)}>Save as draft</Button>
            </div>
          </div>
        </div>
      </div>
    </ERPLayout>
  );
}

type Line = {
  key: string;
  product: string;
  packing: string | null;
  dcQty: number;
  dcPackages: number | null;
  quantity: number;
  packages: number | null;
  remarks: string;
  short: boolean;
  over: boolean;
};

function GroupRows({
  dispatch, lines, setEdit,
}: {
  dispatch: DispatchRow;
  lines: Line[];
  setEdit: (key: string, patch: Partial<LineEdit>) => void;
}) {
  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableCell colSpan={7} className="py-1.5 text-sm font-semibold">
          {dispatch.dispatch_number} <span className="text-muted-foreground font-normal">· {customersOf(dispatch)}</span>
        </TableCell>
      </TableRow>
      {lines.map((l) => (
        <TableRow key={l.key} className={cn(l.over ? "bg-red-50/60" : l.short && "bg-amber-50/60")}>
          <TableCell className="font-medium">{l.product}</TableCell>
          <TableCell className="text-sm text-muted-foreground">{l.packing || "—"}</TableCell>
          <TableCell className="text-right tabular-nums">{fmtQty(l.dcQty)}</TableCell>
          <TableCell className="text-right tabular-nums">{l.dcPackages ?? "—"}</TableCell>
          <TableCell className="text-right">
            <Input
              aria-label={`Issued dozens ${l.product}`}
              inputMode="decimal"
              className={cn("h-9 w-24 text-right tabular-nums ml-auto", l.over && "border-red-500", l.short && !l.over && "border-amber-500")}
              value={String(l.quantity)}
              onChange={(e) => setEdit(l.key, { quantity: e.target.value.replace(/[^0-9.]/g, "") })}
            />
          </TableCell>
          <TableCell className="text-right">
            <Input
              aria-label={`Issued cartons ${l.product}`}
              inputMode="numeric"
              disabled={l.dcPackages === null}
              className={cn("h-9 w-20 text-right tabular-nums ml-auto", l.over && "border-red-500", l.short && !l.over && "border-amber-500")}
              value={l.packages === null ? "" : String(l.packages)}
              onChange={(e) => setEdit(l.key, { packages: e.target.value.replace(/[^0-9]/g, "") })}
            />
          </TableCell>
          <TableCell>
            <Input
              aria-label={`Remark ${l.product}`}
              className={cn("h-9 min-w-[180px]", l.short && !l.remarks.trim() && "border-amber-500")}
              placeholder={l.short ? "Why short? *" : ""}
              value={l.remarks}
              onChange={(e) => setEdit(l.key, { remarks: e.target.value })}
            />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
