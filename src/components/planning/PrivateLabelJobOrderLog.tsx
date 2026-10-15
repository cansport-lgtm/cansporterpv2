import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { fetchLog, type PljoLogEntry } from "@/lib/privateLabelJobOrder";

const ACTION_LABEL: Record<string, string> = {
  created: "Created",
  updated: "Edited",
  issued: "Issued",
  closed: "Closed",
  cancelled: "Cancelled",
  printed: "Printed",
  line_added: "Line added",
  line_changed: "Line changed",
  line_removed: "Line removed",
  logo_added: "Logo uploaded",
  logo_removed: "Logo removed",
  artwork_added: "Artwork uploaded",
  artwork_removed: "Artwork removed",
};

const FIELD_LABEL: Record<string, string> = {
  order_date: "Order date",
  required_by_date: "Required by",
  customer: "Customer",
  billing_customer: "Billing customer",
  grade: "Grade",
  brand_name: "Brand",
  customer_po_ref: "Customer PO / Ref",
  priority: "Priority",
  status: "Status",
  remarks: "Remarks",
  cancel_reason: "Cancel reason",
  size: "Size",
  quantity: "Qty (Dz)",
  packing: "Packing",
  master_packing: "Master packing",
  packs_per_master: "Packs / master",
  file_name: "File",
  number: "Number",
};

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

function isChange(v: unknown): v is { old: unknown; new: unknown } {
  return typeof v === "object" && v !== null && "old" in v && "new" in v;
}

function Details({ entry }: { entry: PljoLogEntry }) {
  const d = entry.details;
  if (!d) return null;
  const { line, source, ...rest } = d as Record<string, unknown>;
  const entries = Object.entries(rest).filter(([, v]) => isChange(v) || (v !== null && v !== ""));
  if (entries.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      {line !== undefined && <li>Line: {show(line)}</li>}
      {entries.map(([k, v]) => (
        <li key={k}>
          <span className="font-medium text-foreground/80">{FIELD_LABEL[k] ?? k}:</span>{" "}
          {isChange(v) ? (
            <>
              <span className="line-through">{show(v.old)}</span> → {show(v.new)}
            </>
          ) : (
            show(v)
          )}
        </li>
      ))}
    </ul>
  );
}

/** Timeline of everything that happened to one private label job order. */
export function PrivateLabelJobOrderLog({ orderId }: { orderId: string }) {
  const { data: log = [], isLoading } = useQuery({
    queryKey: ["pljo-log", orderId],
    queryFn: () => fetchLog(orderId),
  });

  if (isLoading) return <p className="py-6 text-center text-sm text-muted-foreground">Loading log…</p>;
  if (log.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No log entries</p>;

  return (
    <ol className="space-y-3 border-l pl-4">
      {log.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
            <span className="text-xs text-muted-foreground">
              {format(new Date(e.changed_at), "dd MMM yyyy HH:mm")} · {e.app_users?.full_name ?? (e.details?.source === "floor" ? "Floor display" : "Unknown user")}
            </span>
          </div>
          <Details entry={e} />
        </li>
      ))}
    </ol>
  );
}
