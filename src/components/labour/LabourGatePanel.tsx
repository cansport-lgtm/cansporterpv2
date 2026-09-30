import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, BellOff, CheckCircle2, Loader2, LogIn, LogOut, ScanLine, Siren } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmployeeAvatar } from "@/components/labour/EmployeeAvatar";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { startGateAlarm, stopGateAlarm } from "@/lib/gateAlarm";
import {
  PASS_SELECT, errorMessage, fmtTime, lgpDb, overdueMinutes, passKindMeta, statusMeta, todayPk, type LabourGatePass,
} from "@/lib/labourGatePass";

export type LabourLookup = { number?: string; code?: string };

type Result =
  | { action: "out"; pass_kind: string; expected_back_at: string | null; half_day_rows: number | null }
  | { action: "in"; minutes_outside: number; late_minutes: number };

/** A pass in one of these states must never let a worker through again. */
const invalidAtGate = (p: LabourGatePass, today: string) =>
  ["returned", "not_returned", "expired", "rejected", "cancelled"].includes(p.status) ||
  (p.status === "out" && p.pass_kind === "half_day") ||
  (["approved", "out"].includes(p.status) && p.pass_date !== today);

/**
 * Worker pass flow on the Gate Check page: shows the worker's photo and pass,
 * marks Out / In, and sounds the alarm when an old pass is opened again.
 * `lookupId` changes on every Open / scan; `lookupAt` is when that lookup started.
 */
export function LabourGatePanel({ lookup, lookupId, lookupAt, onReset }: { lookup: LabourLookup; lookupId: number; lookupAt: number; onReset: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const today = todayPk();
  const decidedRef = useRef(-1);
  const [alarm, setAlarm] = useState<{ lookup: number; attempts?: number; sounding: boolean } | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const key = lookup.number ?? `code:${lookup.code}`;
  const { data: pass, isFetching, isFetched, dataUpdatedAt } = useQuery<LabourGatePass | null>({
    queryKey: ["gate-check-labour-pass", key],
    queryFn: async () => {
      if (lookup.number) {
        const { data, error } = await lgpDb.from("labour_gate_passes").select(PASS_SELECT).eq("pass_number", lookup.number).maybeSingle();
        if (error) throw error;
        return data;
      }
      // Worker code: today's approved or out pass for that worker.
      const { data, error } = await lgpDb
        .from("labour_gate_passes")
        .select(PASS_SELECT.replace("labour_employees(", "labour_employees!inner("))
        .eq("labour_employees.employee_code", lookup.code)
        .eq("pass_date", today)
        .in("status", ["approved", "out"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => { setResult(null); setAlarm(null); }, [lookupId]);
  useEffect(() => () => stopGateAlarm(), []);

  // Old pass opened again: siren + red screen, and log the attempt (the office is told).
  useEffect(() => {
    if (!pass || isFetching || dataUpdatedAt < lookupAt || decidedRef.current === lookupId) return;
    decidedRef.current = lookupId;
    if (!invalidAtGate(pass, today)) return;
    setAlarm({ lookup: lookupId, sounding: true });
    startGateAlarm();
    lgpDb.rpc("labour_gate_pass_log_rescan", { p_id: pass.id }).then(({ data }: { data: { attempts?: number } | null }) => {
      setAlarm((a) => (a && a.lookup === lookupId ? { ...a, attempts: data?.attempts } : a));
    });
  }, [pass, isFetching, dataUpdatedAt, lookupId, lookupAt, today]);

  const silence = () => { stopGateAlarm(); setAlarm((a) => (a ? { ...a, sounding: false } : a)); };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["gate-check-labour-pass", key] });
    queryClient.invalidateQueries({ queryKey: ["labour-gate-passes"] });
    queryClient.invalidateQueries({ queryKey: ["labour-gate-passes-live"] });
    queryClient.invalidateQueries({ queryKey: ["labour-gate-pass-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["labour-gate-pass-half-days"] });
  };

  const markOut = useMutation({
    mutationFn: async () => {
      const { data, error } = await lgpDb.rpc("labour_gate_pass_gate_out", { p_id: pass!.id });
      if (error) throw error;
      return data as { pass_kind: string; expected_back_at: string | null; half_day_rows: number | null };
    },
    onSuccess: (d) => { setResult({ action: "out", ...d }); invalidate(); },
    onError: (e) => toast({ title: "Could not mark Out", description: errorMessage(e), variant: "destructive" }),
  });

  const markIn = useMutation({
    mutationFn: async () => {
      const { data, error } = await lgpDb.rpc("labour_gate_pass_gate_in", { p_id: pass!.id });
      if (error) throw error;
      return data as { minutes_outside: number; late_minutes: number };
    },
    onSuccess: (d) => { setResult({ action: "in", ...d }); invalidate(); },
    onError: (e) => toast({ title: "Could not mark In", description: errorMessage(e), variant: "destructive" }),
  });

  const reset = () => { stopGateAlarm(); setAlarm(null); setResult(null); onReset(); };

  if (isFetching && !pass) {
    return <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (isFetched && !isFetching && !pass) {
    return (
      <Card><CardContent className="p-6 text-center space-y-3">
        <div className="text-muted-foreground">
          {lookup.number ? `No worker gate pass ${lookup.number}.` : `No approved worker gate pass for code ${lookup.code} today.`}
        </div>
        <Button variant="outline" className="w-full h-11" onClick={reset}><ScanLine className="h-5 w-5 mr-2" /> Check another</Button>
      </CardContent></Card>
    );
  }
  if (!pass) return null;

  const e = pass.labour_employees;
  const kind = passKindMeta(pass.pass_kind);
  const late = overdueMinutes(pass);
  const canOut = pass.status === "approved" && pass.pass_date === today;
  const canIn = pass.status === "out" && pass.pass_kind === "short_leave" && pass.pass_date === today;

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="font-display text-2xl font-bold">{pass.pass_number}</div>
            <span className={cn("text-xs font-semibold rounded-full px-2 py-1 ring-1 ring-inset", kind.badgeClass)}>
              Worker · {kind.label}{pass.pass_kind === "short_leave" && pass.expected_minutes ? ` · ${pass.expected_minutes} min` : ""}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <EmployeeAvatar name={e?.full_name} photoUrl={e?.photo_url} className="h-24 w-24 text-xl" />
            <div className="min-w-0">
              <div className="text-xl font-bold leading-tight">{e?.full_name}</div>
              <div className="text-sm text-muted-foreground">{e?.employee_code}{e?.production_departments?.name ? ` · ${e.production_departments.name}` : ""}</div>
              <div className="text-sm mt-1">Pass for <b>{format(new Date(pass.pass_date), "dd MMM")}</b>{pass.leave_time ? ` · leaving ${pass.leave_time.slice(0, 5)}` : ""}</div>
              <div className="text-xs text-muted-foreground">Approved by {pass.approver?.full_name ?? "—"} · applied by {pass.creator?.full_name ?? "—"}</div>
            </div>
          </div>
          {!e?.photo_url && <div className="text-xs text-amber-700">No photo on file — check the worker's code and name.</div>}
        </CardContent>
      </Card>

      {result ? (
        <Card className={cn("border-emerald-300 bg-emerald-50", result.action === "in" && result.late_minutes > 0 && "border-amber-300 bg-amber-50")}>
          <CardContent className="p-5 text-center space-y-2">
            <CheckCircle2 className={cn("h-12 w-12 mx-auto", result.action === "in" && result.late_minutes > 0 ? "text-amber-700" : "text-emerald-700")} />
            {result.action === "out" ? (
              <>
                <div className="text-xl font-bold text-emerald-800">Marked OUT — the worker may go</div>
                <div className="text-sm">
                  {result.pass_kind === "half_day"
                    ? `Half day marked for today (${result.half_day_rows ?? 0} productivity entr${result.half_day_rows === 1 ? "y" : "ies"} updated).`
                    : `Due back at ${fmtTime(result.expected_back_at)}. Scan the pass again when the worker returns.`}
                </div>
              </>
            ) : (
              <>
                <div className={cn("text-xl font-bold", result.late_minutes > 0 ? "text-amber-800" : "text-emerald-800")}>Marked IN — welcome back</div>
                <div className="text-sm">{result.minutes_outside} min outside{result.late_minutes > 0 ? ` · ${result.late_minutes} min late (the office has been told)` : ""}.</div>
              </>
            )}
            <Button className="w-full h-12 mt-2" onClick={reset}><ScanLine className="h-5 w-5 mr-2" /> Check the next pass</Button>
          </CardContent>
        </Card>
      ) : alarm && alarm.lookup === lookupId ? (
        <div role="alert" className="rounded-xl border-4 border-red-600 bg-red-600 text-white p-5 text-center space-y-3 animate-pulse motion-reduce:animate-none">
          <Siren className="h-16 w-16 mx-auto" />
          <div className="text-2xl font-extrabold uppercase tracking-wide">Old worker pass — do not let the worker through</div>
          <div className="text-base font-semibold">
            {pass.status === "cancelled" || pass.status === "rejected" || pass.status === "expired"
              ? `This pass was ${pass.status}. It is not valid.`
              : pass.pass_date !== today
                ? `This pass is for ${format(new Date(pass.pass_date), "dd MMM")}, not today.`
                : pass.status === "returned"
                  ? `This pass was already used — out ${fmtTime(pass.gate_out_at)}, back ${fmtTime(pass.gate_in_at)}.`
                  : `This pass was already used — the worker went out ${fmtTime(pass.gate_out_at)}${pass.status === "not_returned" ? " and never came back" : " on a half day"}.`}
          </div>
          <div className="text-sm">
            This attempt is logged{alarm.attempts && alarm.attempts > 1 ? ` (${alarm.attempts} attempts on this pass)` : ""} and the office has been told. Stop the worker and call the supervisor.
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            {alarm.sounding && (
              <Button variant="secondary" className="flex-1 h-12 text-base" onClick={silence}><BellOff className="h-5 w-5 mr-2" /> Silence alarm</Button>
            )}
            <Button variant="outline" className="flex-1 h-12 text-base bg-white text-red-700 hover:bg-red-50" onClick={reset}><ScanLine className="h-5 w-5 mr-2" /> Check another pass</Button>
          </div>
        </div>
      ) : canOut ? (
        <div className="sticky bottom-0 bg-background/95 backdrop-blur py-3 space-y-2">
          <div className="text-xs text-center text-muted-foreground">Compare the worker with the photo, code and name above.</div>
          <Button className="w-full h-14 text-lg font-bold bg-emerald-700 hover:bg-emerald-800" disabled={markOut.isPending} onClick={() => markOut.mutate()}>
            {markOut.isPending ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <LogOut className="h-5 w-5 mr-2" />}
            Worker matches · Mark OUT
          </Button>
          <Button variant="outline" className="w-full h-11" onClick={reset}>Not this worker · check another</Button>
        </div>
      ) : canIn ? (
        <div className="sticky bottom-0 bg-background/95 backdrop-blur py-3 space-y-2">
          <div className={cn("rounded-xl border p-3 text-sm text-center", late > 0 ? "border-red-300 bg-red-50 text-red-900" : "border-sky-200 bg-sky-50 text-sky-900")}>
            Went out {fmtTime(pass.gate_out_at)} · due back {fmtTime(pass.expected_back_at)}{late > 0 ? ` · ${late} min late` : ""}
          </div>
          <Button className="w-full h-14 text-lg font-bold" disabled={markIn.isPending} onClick={() => markIn.mutate()}>
            {markIn.isPending ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <LogIn className="h-5 w-5 mr-2" />}
            Worker is back · Mark IN
          </Button>
          <Button variant="outline" className="w-full h-11" onClick={reset}>Check another</Button>
        </div>
      ) : (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-5 text-center space-y-2">
            <AlertTriangle className="h-10 w-10 text-amber-700 mx-auto" />
            <div className="text-lg font-bold">{statusMeta(pass.status).label}</div>
            <div className="text-sm">
              {pass.status === "pending_approval" ? "Not approved yet. The worker cannot go out on it." : "This pass cannot be used at the gate."}
            </div>
            <Button variant="outline" className="w-full h-11" onClick={reset}><ScanLine className="h-5 w-5 mr-2" /> Check another</Button>
          </CardContent>
        </Card>
      )}
    </>
  );
}
