// Floor page for Private Label Job Orders (/floor/private-label). Company
// Product Job Orders (CJO-*) are shown here too, with a tab per order type.
//
// No ERP login: the supervisor unlocks it with the floor PIN, which a super
// admin sets on the Private Label Job Orders page. The PIN is checked by the
// database on every call, so a changed PIN locks the page on its next refresh.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { CheckCircle2, ClipboardEdit, Factory, Loader2, Lock, Printer, RefreshCw, RotateCcw, Tag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PrivateLabelFloorProgressDialog } from "@/components/planning/PrivateLabelFloorProgressDialog";
import { cn } from "@/lib/utils";
import {
  FloorPinError,
  fetchFloorOrderDetail,
  fetchFloorOrders,
  isImage,
  logFloorPrinted,
  producedPct as pct,
  publicUrl,
  setFloorDone,
  type FloorOrder,
  type FloorPinStatus,
  type PljoOrderType,
} from "@/lib/privateLabelJobOrder";
import { printPrivateLabelJobOrder } from "@/lib/privateLabelJobOrderPrint";

const REFRESH_INTERVAL = 15000;
const PIN_STORAGE_KEY = "pljo-floor-pin";
const NAME_STORAGE_KEY = "pljo-floor-name";

type TypeFilter = "all" | PljoOrderType;

const PIN_MESSAGE: Partial<Record<FloorPinStatus, string>> = {
  invalid: "Wrong PIN. Try again.",
  locked: "Too many wrong PINs. The page is locked for a few minutes.",
  not_set: "No floor PIN has been set yet. Ask a super admin to set it on Private Label Job Orders → Floor PIN.",
  not_found: "This job order is no longer Issued.",
  short: "Not every line is at 100% yet, so it cannot be marked done.",
};

const priorityColor = (p: string) => {
  switch (p) {
    case "critical":
      return "bg-red-100 text-red-800 border-red-200";
    case "high":
      return "bg-orange-100 text-orange-800 border-orange-200";
    case "medium":
      return "bg-blue-100 text-blue-800 border-blue-200";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
};

const readPin = () => {
  try {
    return localStorage.getItem(PIN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
};

const readName = () => {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY) || "";
  } catch {
    return "";
  }
};

const writeName = (name: string) => {
  try {
    localStorage.setItem(NAME_STORAGE_KEY, name);
  } catch {
    // Storage blocked: the name just isn't remembered.
  }
};

const writePin = (pin: string) => {
  try {
    if (pin) localStorage.setItem(PIN_STORAGE_KEY, pin);
    else localStorage.removeItem(PIN_STORAGE_KEY);
  } catch {
    // Storage blocked: the PIN just isn't remembered.
  }
};

function PinScreen({ message, onUnlock }: { message: string | null; onUnlock: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin) return;
    setBusy(true);
    try {
      await onUnlock(pin);
    } finally {
      setBusy(false);
      setPin("");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-fuchsia-600 p-2 text-white">
            <Tag className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Private Label &amp; Company Job Orders</h1>
            <p className="text-sm text-muted-foreground">Enter the floor PIN</p>
          </div>
        </div>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={8}
          placeholder="PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          className="text-center text-2xl tracking-[0.5em]"
        />
        {message && <p className="text-sm text-destructive">{message}</p>}
        <Button type="submit" className="w-full" disabled={busy || pin.length < 4}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
          Unlock
        </Button>
      </form>
    </div>
  );
}

interface OrderCardProps {
  order: FloorOrder;
  printing: boolean;
  onPrint: () => void;
  onUpdate: () => void;
  onDone: () => void;
}

function OrderCard({ order, printing, onPrint, onUpdate, onDone }: OrderCardProps) {
  const overdue = order.required_by_date && order.required_by_date < format(new Date(), "yyyy-MM-dd");
  const total = Number(order.total_dozens);
  const done = Number(order.done_dozens);
  const isDone = !!order.production_done_at;
  const isCompany = order.order_type === "company";
  const products = order.product_names ? order.product_names.split(", ") : [];
  // Done only at 100%; the database checks every line, this is the quick guard.
  const short = Math.max(0, total - done);
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border-2 bg-card p-4",
        isCompany && "border-sky-200",
        isDone && "border-green-500 bg-green-50/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-sm font-semibold">{order.pl_job_order_number}</div>
          <div className="text-lg font-bold leading-tight">
            {isCompany ? "Company products" : order.customer_name}
          </div>
          {order.billing_customer_name && (
            <div className="text-sm text-muted-foreground">Bill to: {order.billing_customer_name}</div>
          )}
          {order.brand_name && <div className="text-sm text-muted-foreground">Brand: {order.brand_name}</div>}
        </div>
        {order.last_printed_at ? (
          <Badge variant="outline" className="shrink-0 border-green-300 bg-green-50 text-green-700">
            Printed {formatDistanceToNow(new Date(order.last_printed_at), { addSuffix: true })}
          </Badge>
        ) : (
          <Badge className={cn("shrink-0 text-white", isCompany ? "bg-sky-600 hover:bg-sky-600" : "bg-fuchsia-600 hover:bg-fuchsia-600")}>
            New
          </Badge>
        )}
      </div>

      {isCompany ? (
        <div className="h-28 overflow-y-auto rounded-lg border bg-sky-50/40 p-2 text-sm">
          {products.length > 0 ? (
            <ul className="space-y-0.5">
              {products.map((p, i) => (
                <li key={i} className="truncate font-medium" title={p}>
                  {p}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-muted-foreground">No products</span>
          )}
        </div>
      ) : (
        <div className="flex h-28 items-center justify-center rounded-lg border bg-muted/30">
          {order.logo_path && isImage(order.logo_mime) ? (
            <img src={publicUrl(order.logo_path)} alt="Logo" className="max-h-24 max-w-full object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">{order.logo_path ? "Logo file (see print)" : "No logo"}</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Grade</div>
          <div className="font-semibold">{order.grade_name ?? "—"}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{isCompany ? "Products" : "Sizes"}</div>
          <div className="font-semibold">{order.line_count}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Total Dz</div>
          <div className="font-semibold">{Number(order.total_dozens).toLocaleString()}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {isCompany ? (
          <Badge variant="outline" className="border-sky-300 bg-sky-50 text-sky-700">
            Company
          </Badge>
        ) : (
          <Badge variant="outline" className="border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700">
            Private Label
          </Badge>
        )}
        <Badge variant="outline" className={priorityColor(order.priority)}>
          {order.priority}
        </Badge>
        <span className={cn("text-muted-foreground", overdue && "font-semibold text-destructive")}>
          Required by: {order.required_by_date ? format(parseISO(order.required_by_date), "dd MMM yyyy") : "—"}
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Produced</span>
          <span className="font-semibold">
            {done.toLocaleString()} / {total.toLocaleString()} Dz ({pct(done, total)}%)
          </span>
        </div>
        <Progress value={pct(done, total)} className={cn(isDone && "[&>div]:bg-green-600")} />
        {isDone && (
          <div className="text-xs font-medium text-green-700">
            Production done {format(new Date(order.production_done_at!), "dd MMM HH:mm")}
            {order.production_done_by_name ? ` · ${order.production_done_by_name}` : ""}
          </div>
        )}
      </div>

      <div className="mt-auto grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Button variant="outline" onClick={onUpdate} disabled={isDone} title="Enter production">
          <ClipboardEdit className="mr-1 h-4 w-4" />
          Update
        </Button>
        <Button
          variant={isDone ? "outline" : "default"}
          className={cn(!isDone && "bg-green-600 hover:bg-green-700")}
          onClick={onDone}
          disabled={!isDone && short > 0}
          title={!isDone && short > 0 ? `${short.toLocaleString()} Dz still to make` : undefined}
        >
          {isDone ? <RotateCcw className="mr-1 h-4 w-4" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
          {isDone ? "Reopen" : "Done"}
        </Button>
        <Button variant="outline" onClick={onPrint} disabled={printing}>
          {printing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Printer className="mr-1 h-4 w-4" />}
          Print
        </Button>
      </div>
    </div>
  );
}

export default function PrivateLabelFloorPage() {
  const qc = useQueryClient();
  const [pin, setPin] = useState(readPin);
  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [progressOrder, setProgressOrder] = useState<FloorOrder | null>(null);
  const [doneOrder, setDoneOrder] = useState<FloorOrder | null>(null);
  const [savingDone, setSavingDone] = useState(false);
  // Done orders leave the list; this brings them back so one can be reopened.
  const [showDone, setShowDone] = useState(false);
  const [enteredBy, setEnteredBy] = useState(readName);

  const changeName = (name: string) => {
    setEnteredBy(name);
    writeName(name);
  };
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const lock = (status: FloorPinStatus | null) => {
    writePin("");
    setPin("");
    setPinMessage(status ? PIN_MESSAGE[status] ?? null : null);
    qc.removeQueries({ queryKey: ["pljo-floor"] });
  };

  const {
    data: orders = [],
    error,
    isLoading,
    isFetching,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ["pljo-floor", pin],
    queryFn: () => fetchFloorOrders(pin),
    enabled: !!pin,
    refetchInterval: REFRESH_INTERVAL,
    retry: (count, err) => !(err instanceof FloorPinError) && count < 2,
  });

  // A changed or removed PIN sends the screen back to the PIN prompt. A
  // lockout keeps the PIN: the page recovers on its own once it lifts.
  const pinStatus = error instanceof FloorPinError ? error.status : null;
  useEffect(() => {
    if (pinStatus === "invalid" || pinStatus === "not_set") lock(pinStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinStatus]);

  const unlock = async (entered: string) => {
    try {
      const data = await fetchFloorOrders(entered);
      qc.setQueryData(["pljo-floor", entered], data);
      writePin(entered);
      setPinMessage(null);
      setPin(entered);
    } catch (e) {
      setPinMessage(
        e instanceof FloorPinError ? PIN_MESSAGE[e.status] ?? "Could not unlock" : "Could not reach the server. Try again.",
      );
    }
  };

  const print = async (order: FloorOrder) => {
    setPrintingId(order.id);
    try {
      const detail = await fetchFloorOrderDetail(pin, order.id);
      printPrivateLabelJobOrder(detail);
      await logFloorPrinted(pin, order.id);
      qc.invalidateQueries({ queryKey: ["pljo-floor"] });
    } catch (e) {
      if (e instanceof FloorPinError && (e.status === "invalid" || e.status === "not_set")) {
        lock(e.status);
      } else {
        toast.error(e instanceof FloorPinError ? PIN_MESSAGE[e.status] ?? "Could not print" : "Could not print. Try again.");
        if (e instanceof FloorPinError && e.status === "not_found") qc.invalidateQueries({ queryKey: ["pljo-floor"] });
      }
    } finally {
      setPrintingId(null);
    }
  };

  const handlePinError = (e: FloorPinError) => {
    if (e.status === "invalid" || e.status === "not_set") lock(e.status);
    else {
      toast.error(PIN_MESSAGE[e.status] ?? "Could not save");
      qc.invalidateQueries({ queryKey: ["pljo-floor"] });
    }
  };

  const confirmDone = async () => {
    if (!doneOrder) return;
    const marking = !doneOrder.production_done_at;
    if (marking && !enteredBy.trim()) {
      toast.error("Enter your name");
      return;
    }
    setSavingDone(true);
    try {
      await setFloorDone(pin, doneOrder.id, marking, enteredBy);
      toast.success(marking ? "Marked as done and moved off the list" : "Reopened");
      setDoneOrder(null);
      qc.invalidateQueries({ queryKey: ["pljo-floor"] });
    } catch (e) {
      if (e instanceof FloorPinError) handlePinError(e);
      else toast.error("Could not save. Try again.");
    } finally {
      setSavingDone(false);
    }
  };

  // Orders of the chosen tab; the stats and the list both follow it.
  const typeOrders = useMemo(
    () => (typeFilter === "all" ? orders : orders.filter((o) => (o.order_type ?? "private_label") === typeFilter)),
    [orders, typeFilter],
  );
  const typeCount = (t: PljoOrderType) =>
    orders.filter((o) => (o.order_type ?? "private_label") === t && !o.production_done_at).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Done orders are hidden unless asked for, then listed after the rest.
    const sorted = (showDone ? [...typeOrders] : typeOrders.filter((o) => !o.production_done_at)).sort(
      (a, b) => Number(!!a.production_done_at) - Number(!!b.production_done_at),
    );
    if (!q) return sorted;
    return sorted.filter((o) =>
      [
        o.pl_job_order_number,
        o.customer_name,
        o.billing_customer_name,
        o.brand_name,
        o.customer_po_ref,
        o.grade_name,
        o.product_names,
        o.product_codes,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [typeOrders, search, showDone]);

  if (!pin) return <PinScreen message={pinMessage} onUnlock={unlock} />;

  const notPrinted = typeOrders.filter((o) => !o.last_printed_at).length;
  const doneCount = typeOrders.filter((o) => o.production_done_at).length;
  const totalDz = typeOrders.reduce((s, o) => s + Number(o.total_dozens), 0);
  const doneDz = typeOrders.reduce((s, o) => s + Number(o.done_dozens), 0);

  return (
    <div className="min-h-screen bg-background p-4 text-foreground">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-fuchsia-600 p-2 text-white">
            <Tag className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Private Label &amp; Company Job Orders</h1>
            <p className="text-sm text-muted-foreground">{format(now, "EEEE, d MMM yyyy — hh:mm:ss a")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search number, customer, brand, product, grade…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          {doneCount > 0 && (
            <Button variant={showDone ? "secondary" : "outline"} onClick={() => setShowDone((v) => !v)}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {showDone ? "Hide done" : `Show done (${doneCount})`}
            </Button>
          )}
          <Button variant="outline" onClick={() => lock(null)}>
            <Lock className="mr-2 h-4 w-4" />
            Lock
          </Button>
        </div>
      </div>

      <Tabs value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)} className="mb-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="all" className="px-4 py-2 text-base">
            All ({typeCount("private_label") + typeCount("company")})
          </TabsTrigger>
          <TabsTrigger value="private_label" className="px-4 py-2 text-base">
            <Tag className="mr-2 h-4 w-4 text-fuchsia-600" />
            Private Label ({typeCount("private_label")})
          </TabsTrigger>
          <TabsTrigger value="company" className="px-4 py-2 text-base">
            <Factory className="mr-2 h-4 w-4 text-sky-600" />
            Company Products ({typeCount("company")})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {pinStatus === "locked" && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {PIN_MESSAGE.locked}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 text-center">
          <div className="text-sm text-muted-foreground">Issued orders</div>
          <div className="text-4xl font-bold">{typeOrders.length}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 text-center">
          <div className="text-sm text-muted-foreground">Production done</div>
          <div className="text-4xl font-bold text-green-600">
            {doneCount}
            <span className="text-xl text-muted-foreground"> / {typeOrders.length}</span>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-4 text-center">
          <div className="text-sm text-muted-foreground">Produced (all orders)</div>
          <div className="text-4xl font-bold">{pct(doneDz, totalDz)}%</div>
          <div className="text-xs text-muted-foreground">
            {doneDz.toLocaleString()} / {totalDz.toLocaleString()} Dz
          </div>
        </div>
        <div className="rounded-xl border bg-card p-4 text-center">
          <div className="text-sm text-muted-foreground">Not printed yet</div>
          <div className={cn("text-4xl font-bold", notPrinted > 0 && "text-fuchsia-600")}>{notPrinted}</div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
          {typeOrders.length === 0
            ? typeFilter === "company"
              ? "No issued company product job orders"
              : typeFilter === "private_label"
                ? "No issued private label job orders"
                : "No issued job orders"
            : search.trim()
              ? "No orders match the search"
              : "All orders are done"}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              printing={printingId === o.id}
              onPrint={() => print(o)}
              onUpdate={() => setProgressOrder(o)}
              onDone={() => setDoneOrder(o)}
            />
          ))}
        </div>
      )}

      {progressOrder && (
        <PrivateLabelFloorProgressDialog
          pin={pin}
          order={progressOrder}
          enteredBy={enteredBy}
          onEnteredByChange={changeName}
          onPinError={(e) => {
            setProgressOrder(null);
            handlePinError(e);
          }}
          onClose={(saved) => {
            setProgressOrder(null);
            if (saved) qc.invalidateQueries({ queryKey: ["pljo-floor"] });
          }}
        />
      )}

      <AlertDialog open={!!doneOrder} onOpenChange={(o) => !o && setDoneOrder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {doneOrder?.production_done_at ? "Reopen production?" : "Mark production done?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {doneOrder && (
                <>
                  {doneOrder.pl_job_order_number} · {doneOrder.customer_name ?? "Company products"}. Produced{" "}
                  {Number(doneOrder.done_dozens).toLocaleString()} of {Number(doneOrder.total_dozens).toLocaleString()} Dz
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {doneOrder && !doneOrder.production_done_at && (
            <div className="space-y-1">
              <Label>Your name</Label>
              <Input value={enteredBy} onChange={(e) => changeName(e.target.value)} />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingDone}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={savingDone}
              onClick={(e) => {
                e.preventDefault();
                confirmDone();
              }}
            >
              {savingDone && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {doneOrder?.production_done_at ? "Reopen" : "Mark done"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="mt-6 flex items-center justify-end gap-2 text-xs text-muted-foreground">
        <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
        Auto-refresh: 15s
        {dataUpdatedAt > 0 && <> · Updated {format(dataUpdatedAt, "hh:mm:ss a")}</>}
      </div>
    </div>
  );
}
