import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { hoursBetween, type TrackingRow } from "@/lib/storePass";

// DC → SP → GP → Out → Delivered for one dispatch, with the hours between the
// steps. Green = done, red = missing (a later step happened without it),
// amber = held, hollow blue = the next step.

type Dot = "done" | "missing" | "held" | "next" | "todo";

const dotClass: Record<Dot, string> = {
  done: "bg-emerald-600 border-emerald-600",
  missing: "bg-red-600 border-red-600",
  held: "bg-amber-500 border-amber-500",
  next: "bg-white border-indigo-600 border-[3px]",
  todo: "bg-white border-slate-300",
};

const t = (s: string | null | undefined) => (s ? format(new Date(s), "HH:mm") : "—");

export function StageStrip({ r }: { r: TrackingRow }) {
  const issued = r.sp_status === "issued" ? r.sp_issued_at : null;
  const gpMade = r.gate_pass_id ? r.gp_created_at : null;
  const out = r.gate_out_at;
  const delivered = r.actual_delivery_date ?? r.acknowledgement_date;
  const isDelivered = r.stage === "delivered" || r.stage === "returned";

  const steps: { label: string; at: string | null; dot: Dot; gap?: string }[] = [
    { label: "DC", at: r.dispatch_created_at, dot: "done" },
    {
      label: "SP",
      at: issued,
      dot: issued ? "done" : gpMade || out || isDelivered ? "missing" : r.sp_status === "draft" ? "next" : "next",
      gap: issued ? hoursBetween(r.dispatch_created_at, issued) : undefined,
    },
    {
      label: "GP",
      at: gpMade,
      dot: gpMade ? "done" : out || isDelivered ? "missing" : issued ? "next" : "todo",
      gap: gpMade ? hoursBetween(issued ?? r.dispatch_created_at, gpMade) : undefined,
    },
    {
      label: "Out",
      at: out,
      dot: out ? "done" : r.stage === "held" ? "held" : isDelivered ? "missing" : gpMade ? "next" : "todo",
      gap: out ? hoursBetween(gpMade ?? issued ?? r.dispatch_created_at, out) : r.stage === "held" ? `held ${t(r.gp_held_at)}` : undefined,
    },
    {
      label: "Dlvd",
      at: isDelivered ? (delivered ?? null) : null,
      dot: isDelivered ? "done" : out ? "next" : "todo",
      gap: isDelivered && delivered && out ? hoursBetween(out, delivered) : undefined,
    },
  ];

  return (
    <div className="flex items-start min-w-[380px]">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-start flex-1 last:flex-none">
          <div className="flex flex-col items-center w-16 shrink-0">
            <div className={cn("h-3.5 w-3.5 rounded-full border-2 box-border", dotClass[s.dot])} />
            <div className="text-[10px] text-muted-foreground whitespace-nowrap mt-0.5">
              {s.label} {s.at ? (s.label === "Dlvd" && s.at.length === 10 ? format(new Date(s.at), "dd MMM") : t(s.at)) : s.dot === "missing" ? "—" : ""}
            </div>
          </div>
          {i < steps.length - 1 && (
            <div className="flex-1 flex flex-col items-center pt-1.5 min-w-[14px]">
              <div className={cn("h-0.5 w-full", steps[i + 1].dot === "done" ? "bg-emerald-500" : "bg-slate-200")} />
              {steps[i + 1].gap && (
                <div className={cn("text-[10px] whitespace-nowrap mt-0.5", steps[i + 1].dot === "held" ? "text-amber-700 font-semibold" : "text-muted-foreground")}>
                  {steps[i + 1].gap}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
