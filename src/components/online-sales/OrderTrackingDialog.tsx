import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, Loader2, MapPin } from "lucide-react";
import { format } from "date-fns";

interface TrackOrder {
  id: string;
  order_number?: string | null;
  customer_name?: string | null;
  tracking_number?: string | null;
}

interface Step {
  updatedAt: string;
  transactionStatusMessage: string;
  transactionStatusMessageCode?: string;
}

export function OrderTrackingDialog({
  order, open, onOpenChange,
}: {
  order: TrackOrder | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [currentStatus, setCurrentStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!open || !order) return;
    let cancelled = false;

    (async () => {
      setLoading(true); setError(""); setSteps([]); setCurrentStatus("");
      if (!order.tracking_number) { setError("This order has no tracking number yet."); setLoading(false); return; }

      // Refresh this order's status live from PostEx, then read the stored journey.
      await supabase.functions.invoke("postex", { body: { action: "track", orderId: order.id } });

      const { data } = await supabase
        .from("online_tracking_events")
        .select("raw, status_message, created_at")
        .eq("order_id", order.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (cancelled) return;
      const raw: any = data?.[0]?.raw;
      const dist = raw?.dist || raw;
      const history: Step[] = dist?.transactionStatusHistory || [];
      // newest first
      const sorted = [...history].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      setSteps(sorted);
      setCurrentStatus(dist?.transactionStatus || data?.[0]?.status_message || "");
      if (history.length === 0) setError("No tracking history available from PostEx yet.");
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [open, order]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" /> Live Tracking
          </DialogTitle>
          <DialogDescription>
            {order?.order_number || order?.tracking_number} {order?.customer_name ? `· ${order.customer_name}` : ""}
          </DialogDescription>
        </DialogHeader>

        {order?.tracking_number && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Tracking #</span>
            <span className="font-mono">{order.tracking_number}</span>
            {currentStatus && <Badge variant="outline" className="ml-auto">{currentStatus}</Badge>}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" /> Fetching live status from PostEx…
          </div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{error}</div>
        ) : (
          <ol className="relative border-l border-muted ml-2 mt-2 space-y-4">
            {steps.map((s, i) => (
              <li key={i} className="ml-4">
                <span className="absolute -left-[9px] mt-1">
                  {i === 0
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-600 bg-background" />
                    : <Circle className="h-4 w-4 text-muted-foreground bg-background" />}
                </span>
                <div className={`text-sm ${i === 0 ? "font-semibold" : ""}`}>{s.transactionStatusMessage}</div>
                <div className="text-xs text-muted-foreground">
                  {(() => { try { return format(new Date(s.updatedAt), "dd MMM yyyy, HH:mm"); } catch { return s.updatedAt; } })()}
                </div>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
