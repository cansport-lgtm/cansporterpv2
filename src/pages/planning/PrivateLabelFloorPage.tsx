// Floor page for Private Label Job Orders (/floor/private-label).
//
// No ERP login: the supervisor unlocks it with the floor PIN, which a super
// admin sets on the Private Label Job Orders page. The PIN is checked by the
// database on every call, so a changed PIN locks the page on its next refresh.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { Loader2, Lock, Printer, RefreshCw, Tag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  FloorPinError,
  fetchFloorOrderDetail,
  fetchFloorOrders,
  isImage,
  logFloorPrinted,
  publicUrl,
  type FloorOrder,
  type FloorPinStatus,
} from "@/lib/privateLabelJobOrder";
import { printPrivateLabelJobOrder } from "@/lib/privateLabelJobOrderPrint";

const REFRESH_INTERVAL = 15000;
const PIN_STORAGE_KEY = "pljo-floor-pin";

const PIN_MESSAGE: Partial<Record<FloorPinStatus, string>> = {
  invalid: "Wrong PIN. Try again.",
  locked: "Too many wrong PINs. The page is locked for a few minutes.",
  not_set: "No floor PIN has been set yet. Ask a super admin to set it on Private Label Job Orders → Floor PIN.",
  not_found: "This job order is no longer Issued.",
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
            <h1 className="text-lg font-bold">Private Label Job Orders</h1>
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

function OrderCard({ order, printing, onPrint }: { order: FloorOrder; printing: boolean; onPrint: () => void }) {
  const overdue = order.required_by_date && order.required_by_date < format(new Date(), "yyyy-MM-dd");
  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-sm font-semibold">{order.pl_job_order_number}</div>
          <div className="text-lg font-bold leading-tight">{order.customer_name}</div>
          {order.brand_name && <div className="text-sm text-muted-foreground">Brand: {order.brand_name}</div>}
        </div>
        {order.last_printed_at ? (
          <Badge variant="outline" className="shrink-0 border-green-300 bg-green-50 text-green-700">
            Printed {formatDistanceToNow(new Date(order.last_printed_at), { addSuffix: true })}
          </Badge>
        ) : (
          <Badge className="shrink-0 bg-fuchsia-600 text-white hover:bg-fuchsia-600">New</Badge>
        )}
      </div>

      <div className="flex h-28 items-center justify-center rounded-lg border bg-muted/30">
        {order.logo_path && isImage(order.logo_mime) ? (
          <img src={publicUrl(order.logo_path)} alt="Logo" className="max-h-24 max-w-full object-contain" />
        ) : (
          <span className="text-xs text-muted-foreground">{order.logo_path ? "Logo file (see print)" : "No logo"}</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Grade</div>
          <div className="font-semibold">{order.grade_name}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Sizes</div>
          <div className="font-semibold">{order.line_count}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Total Dz</div>
          <div className="font-semibold">{Number(order.total_dozens).toLocaleString()}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline" className={priorityColor(order.priority)}>
          {order.priority}
        </Badge>
        <span className={cn("text-muted-foreground", overdue && "font-semibold text-destructive")}>
          Required by: {order.required_by_date ? format(parseISO(order.required_by_date), "dd MMM yyyy") : "—"}
        </span>
      </div>

      <Button className="mt-auto w-full" onClick={onPrint} disabled={printing}>
        {printing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
        Print
      </Button>
    </div>
  );
}

export default function PrivateLabelFloorPage() {
  const qc = useQueryClient();
  const [pin, setPin] = useState(readPin);
  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [printingId, setPrintingId] = useState<string | null>(null);
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      [o.pl_job_order_number, o.customer_name, o.brand_name, o.customer_po_ref, o.grade_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [orders, search]);

  if (!pin) return <PinScreen message={pinMessage} onUnlock={unlock} />;

  const notPrinted = orders.filter((o) => !o.last_printed_at).length;

  return (
    <div className="min-h-screen bg-background p-4 text-foreground">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-fuchsia-600 p-2 text-white">
            <Tag className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Private Label Job Orders</h1>
            <p className="text-sm text-muted-foreground">{format(now, "EEEE, d MMM yyyy — hh:mm:ss a")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search number, customer, brand, grade…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <Button variant="outline" onClick={() => lock(null)}>
            <Lock className="mr-2 h-4 w-4" />
            Lock
          </Button>
        </div>
      </div>

      {pinStatus === "locked" && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {PIN_MESSAGE.locked}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4">
        <div className="rounded-xl border bg-card p-4 text-center">
          <div className="text-sm text-muted-foreground">Issued orders</div>
          <div className="text-4xl font-bold">{orders.length}</div>
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
          {orders.length === 0 ? "No issued private label job orders" : "No orders match the search"}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((o) => (
            <OrderCard key={o.id} order={o} printing={printingId === o.id} onPrint={() => print(o)} />
          ))}
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-2 text-xs text-muted-foreground">
        <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
        Auto-refresh: 15s
        {dataUpdatedAt > 0 && <> · Updated {format(dataUpdatedAt, "hh:mm:ss a")}</>}
      </div>
    </div>
  );
}
