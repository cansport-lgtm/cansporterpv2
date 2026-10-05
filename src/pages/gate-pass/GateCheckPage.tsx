import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Html5Qrcode } from "html5-qrcode";
import { AlertTriangle, BellOff, Camera, CheckCircle2, Loader2, QrCode, ScanLine, Siren } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ScrapWeighPanel } from "@/components/gate-pass/ScrapWeighPanel";
import { GuardShell } from "@/components/gate-pass/GuardShell";
import { InwardGatePanel } from "@/components/gate-pass/InwardGatePanel";
import { isInwardNumber, normalizeInwardNumber } from "@/lib/gateInward";
import { StorePassGateNotice } from "@/components/store-pass/StorePassGateNotice";
import { PersonGatePanel, type PersonLookup } from "@/components/person-gate-pass/PersonGatePanel";
import {
  PERSON_PASS_VARIANTS, STAFF_PASS, WORKER_PASS, detectPersonPassVariant, isFullPassNumber, normalizePersonPassNumber,
  type PersonPassVariant,
} from "@/lib/personGatePass";
import { primeGateAlarm, startGateAlarm, stopGateAlarm } from "@/lib/gateAlarm";
import {
  PASS_SELECT, REUSE_ALARM_STATUSES, countUnit, errorMessage, expectedCount, fmtQty, gpDb, normalizePassNumber, passTypeMeta,
  sortedItems, statusMeta, type GatePass,
} from "@/lib/gatePass";

const SCANNER_ID = "gate-pass-scanner";
const normVehicle = (v: string | null | undefined) => (v ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

type CheckResult = {
  status: "out" | "held";
  vehicle_ok?: boolean;
  mismatches?: { line_no: number; description: string; expected: number; counted: number }[];
  problems?: string[]; // scrap weighment
  missing_store_pass?: string[]; // sales pass that went out with no store pass (warn mode)
};

export default function GateCheckPage() {
  const { roles, hasModulePermission } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const guardOnly = roles.some((r) => r.role === "gate_security") && !hasModulePermission("gate_pass", "create");
  const canCheck = roles.some((r) => ["gate_security", "gate_pass_manager", "super_admin"].includes(r.role));

  const [code, setCode] = useState("");
  const [passNumber, setPassNumber] = useState<string | null>(null);
  // Goods passes (GP-…), worker passes (LGP-…), staff passes (SGP-…) and inward
  // entries (GIN-…) share this screen. A scanned QR picks the flow by its prefix;
  // typed input follows the selected mode.
  const [mode, setMode] = useState<"goods" | "worker" | "staff" | "inward">("goods");
  const [personLookup, setPersonLookup] = useState<{ variant: PersonPassVariant; lookup: PersonLookup } | null>(null);
  const [inwardNumber, setInwardNumber] = useState<string | null>(null);
  const modeVariant = mode === "worker" ? WORKER_PASS : mode === "staff" ? STAFF_PASS : null;
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [vehicle, setVehicle] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  // Sales pass with a dispatch that has no store pass while the setting is "block".
  const [spBlocked, setSpBlocked] = useState(false);
  // Each Open / scan is one lookup; the alarm decision is made once per lookup, on the
  // pass as it stood when it was opened (so marking a pass Out never sets it off).
  const [lookupId, setLookupId] = useState(0);
  const decidedRef = useRef(-1);
  const lookupAtRef = useRef(0);
  const [alarm, setAlarm] = useState<{ lookup: number; attempts?: number; sounding: boolean } | null>(null);

  const { data: pass, isFetching, isFetched, dataUpdatedAt } = useQuery<GatePass | null>({
    queryKey: ["gate-check-pass", passNumber],
    enabled: Boolean(passNumber),
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_passes").select(PASS_SELECT).eq("pass_number", passNumber).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // New pass on screen: start the count from blank.
  useEffect(() => {
    setCounts({});
    setVehicle("");
    setNote("");
    setResult(null);
    setSpBlocked(false);
  }, [passNumber]);

  const lookUp = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    primeGateAlarm();
    stopGateAlarm();
    setAlarm(null);
    lookupAtRef.current = Date.now();
    setLookupId((x) => x + 1);
    if (isInwardNumber(text) || (mode === "inward" && !/^(GP|LGP|SGP)-?\d+$/i.test(text))) {
      const n = normalizeInwardNumber(text);
      setMode("inward");
      setCode(n);
      setPassNumber(null);
      setPersonLookup(null);
      setInwardNumber(n);
      queryClient.invalidateQueries({ queryKey: ["gate-check-inward", n] });
      return;
    }
    const personVariant = detectPersonPassVariant(text) ?? (modeVariant && !/^GP-?\d+$/i.test(text) ? modeVariant : null);
    if (personVariant) {
      // Worker / staff pass by number, or today's pass by employee code.
      const n = normalizePersonPassNumber(personVariant, text);
      const lookup: PersonLookup = isFullPassNumber(personVariant, n) ? { number: n } : { code: n };
      setMode(personVariant.key);
      setCode(lookup.number ?? lookup.code ?? "");
      setPassNumber(null);
      setInwardNumber(null);
      setPersonLookup({ variant: personVariant, lookup });
      PERSON_PASS_VARIANTS.forEach((v) => queryClient.invalidateQueries({ queryKey: [`gate-check-${v.key}-pass`] }));
      return;
    }
    const n = normalizePassNumber(text);
    if (!n) return;
    setMode("goods");
    setPersonLookup(null);
    setInwardNumber(null);
    setCode(n);
    setPassNumber(n);
    queryClient.invalidateQueries({ queryKey: ["gate-check-pass", n] });
  };

  const stopScanner = () => {
    scannerRef.current?.stop().catch(() => {});
    scannerRef.current = null;
    setScanning(false);
  };

  const startScanner = async () => {
    primeGateAlarm();
    setScanning(true);
    // Wait a tick so the scanner's container is on the page.
    await new Promise((r) => setTimeout(r, 50));
    try {
      const scanner = new Html5Qrcode(SCANNER_ID);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (text) => {
          stopScanner();
          lookUp(text);
        },
        () => {},
      );
    } catch {
      toast({ title: "Camera not available", description: "Type the GP number instead.", variant: "destructive" });
      setScanning(false);
    }
  };

  useEffect(() => () => { scannerRef.current?.stop().catch(() => {}); stopGateAlarm(); }, []);

  // Old pass opened again: siren + red screen, and log the attempt (managers are notified).
  useEffect(() => {
    // Decide only on data fetched after this lookup, never on a cached copy.
    if (!pass || isFetching || dataUpdatedAt < lookupAtRef.current || decidedRef.current === lookupId) return;
    decidedRef.current = lookupId;
    if (!REUSE_ALARM_STATUSES.includes(pass.status)) return;
    setAlarm({ lookup: lookupId, sounding: true });
    startGateAlarm();
    gpDb.rpc("gate_pass_log_rescan", { p_id: pass.id }).then(({ data }: { data: { attempts?: number } | null }) => {
      setAlarm((a) => (a && a.lookup === lookupId ? { ...a, attempts: data?.attempts } : a));
    });
  }, [pass, isFetching, dataUpdatedAt, lookupId]);

  const silence = () => {
    stopGateAlarm();
    setAlarm((a) => (a ? { ...a, sounding: false } : a));
  };

  const items = pass ? sortedItems(pass).filter((i) => Number(i.quantity) > 0) : [];
  const lineState = (id: string, expected: number) => {
    const v = counts[id];
    if (v === undefined || v === "") return "blank" as const;
    return Number(v) === expected ? ("match" as const) : ("diff" as const);
  };
  const allCounted = items.length > 0 && items.every((i) => lineState(i.id, expectedCount(i)) !== "blank");
  const allMatch = allCounted && items.every((i) => lineState(i.id, expectedCount(i)) === "match");
  const vehicleOk = !pass?.vehicle_number || normVehicle(vehicle) === normVehicle(pass.vehicle_number);
  const goesOut = allMatch && vehicleOk;
  const canAct = pass && ["approved", "held"].includes(pass.status);

  const check = useMutation({
    mutationFn: async () => {
      const { data, error } = await gpDb.rpc("gate_pass_gate_check", {
        p_id: pass!.id,
        p_counts: items.map((i) => ({ item_id: i.id, counted: counts[i.id] })),
        p_vehicle: vehicle,
        p_note: note,
      });
      if (error) throw error;
      return data as CheckResult;
    },
    onSuccess: (r) => {
      setResult(r);
      queryClient.invalidateQueries({ queryKey: ["gate-check-pass", passNumber] });
      queryClient.invalidateQueries({ queryKey: ["gate-passes"] });
      queryClient.invalidateQueries({ queryKey: ["gate-passes-live"] });
      queryClient.invalidateQueries({ queryKey: ["gate-pass-approvals"] });
    },
    onError: (e) => toast({ title: "Could not record the check", description: errorMessage(e), variant: "destructive" }),
  });

  const reset = () => {
    stopGateAlarm();
    setAlarm(null);
    setPassNumber(null);
    setPersonLookup(null);
    setInwardNumber(null);
    setCode("");
    setResult(null);
  };

  const Shell = guardOnly ? GuardShell : ERPLayout;

  if (!canCheck) {
    return <Shell><div className="p-8 text-center text-muted-foreground">Only gate security or a gate pass manager can use Gate Check.</div></Shell>;
  }

  return (
    <Shell>
      <div className="space-y-3 max-w-xl mx-auto">
        {!guardOnly && <h1 className="page-title">Gate Check</h1>}

        <Card>
          <CardContent className="p-3 space-y-3">
            <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Pass kind">
              {([["goods", "Goods out"], ["worker", "Worker"], ["staff", "Staff"], ["inward", "Inward"]] as const).map(([m, label]) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m}
                  className={cn("h-10 rounded-md text-sm font-semibold transition-colors", mode === m ? "bg-background shadow" : "text-muted-foreground")}
                  onClick={() => { setMode(m); setCode(""); setPassNumber(null); setPersonLookup(null); setInwardNumber(null); }}>
                  {label}
                </button>
              ))}
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); lookUp(code); }}>
              <Label htmlFor="gp-code" className="sr-only">{modeVariant ? `${modeVariant.prefix} number or ${modeVariant.noun} code` : mode === "inward" ? "GIN number" : "GP number"}</Label>
              <Input id="gp-code" value={code} inputMode="text"
                placeholder={modeVariant ? `${modeVariant.prefix} number or ${modeVariant.noun} code` : mode === "inward" ? "GIN number, e.g. 12" : "GP number, e.g. 131"}
                className="h-12 text-lg" onChange={(e) => setCode(e.target.value)} />
              <Button type="submit" className="h-12 px-5">Open</Button>
            </form>
            {scanning ? (
              <div className="space-y-2">
                <div id={SCANNER_ID} className="w-full overflow-hidden rounded-lg" />
                <Button variant="outline" className="w-full h-11" onClick={stopScanner}>Stop camera</Button>
              </div>
            ) : (
              <Button variant="secondary" className="w-full h-12 text-base" onClick={startScanner}>
                <Camera className="h-5 w-5 mr-2" /> Scan QR on the pass
              </Button>
            )}
          </CardContent>
        </Card>

        {personLookup && (
          <PersonGatePanel key={personLookup.variant.key} variant={personLookup.variant} lookup={personLookup.lookup} lookupId={lookupId} lookupAt={lookupAtRef.current} onReset={reset} />
        )}
        {mode === "inward" && (
          <InwardGatePanel number={inwardNumber} lookupId={lookupId} onReset={reset} />
        )}

        {passNumber && isFetching && !pass && (
          <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
        )}
        {passNumber && isFetched && !isFetching && !pass && (
          <Card><CardContent className="p-6 text-center text-muted-foreground">No gate pass {passNumber}.</CardContent></Card>
        )}

        {pass && (
          <>
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-display text-2xl font-bold">{pass.pass_number}</div>
                  <span className="text-xs font-semibold rounded-full bg-indigo-50 text-indigo-700 px-2 py-1">
                    {passTypeMeta(pass.pass_type).label}
                    {pass.pass_type === "sales" ? ` · ${pass.gate_pass_dispatches?.length ?? 0} dispatch(es)` : ""}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">{pass.party_name}</div>
                <div className="text-sm">
                  Vehicle on pass: <b>{pass.vehicle_number || "none (hand carry / courier)"}</b>
                  {pass.driver_name ? <> · Driver: <b>{pass.driver_name}</b></> : null}
                </div>
              </CardContent>
            </Card>

            {result ? (
              <Card className={cn(result.status === "out" ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50")}>
                <CardContent className="p-5 text-center space-y-2">
                  {result.status === "out" ? (
                    <>
                      <CheckCircle2 className="h-12 w-12 text-emerald-700 mx-auto" />
                      <div className="text-xl font-bold text-emerald-800">Marked Out — the vehicle may go</div>
                      {result.missing_store_pass?.length ? (
                        <div className="text-sm text-amber-800">No store pass for {result.missing_store_pass.join(", ")} — logged, the store managers have been told.</div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-12 w-12 text-red-700 mx-auto" />
                      <div className="text-xl font-bold text-red-800">Held — do not let the vehicle go</div>
                      <div className="text-sm text-red-900">The office and the manager have been told.</div>
                      {result.problems?.map((p) => <div key={p} className="text-sm text-red-900 font-medium">{p}</div>)}
                    </>
                  )}
                  <Button className="w-full h-12 mt-2" onClick={reset}><ScanLine className="h-5 w-5 mr-2" /> Check the next pass</Button>
                </CardContent>
              </Card>
            ) : alarm && alarm.lookup === lookupId ? (
              <div role="alert" className="rounded-xl border-4 border-red-600 bg-red-600 text-white p-5 text-center space-y-3 animate-pulse motion-reduce:animate-none">
                <Siren className="h-16 w-16 mx-auto" />
                <div className="text-2xl font-extrabold uppercase tracking-wide">Old gate pass — do not let the vehicle go</div>
                <div className="text-base font-semibold">
                  {pass.status === "cancelled" || pass.status === "rejected"
                    ? `This pass was ${pass.status}. It is not valid.`
                    : `This pass was already used${pass.gate_out_at ? ` — went out ${format(new Date(pass.gate_out_at), "dd MMM yyyy, HH:mm")}` : ""}.`}
                </div>
                <div className="text-sm">
                  This attempt is logged{alarm.attempts && alarm.attempts > 1 ? ` (${alarm.attempts} attempts on this pass)` : ""} and the manager has been told. Stop the vehicle and call the office.
                </div>
                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  {alarm.sounding && (
                    <Button variant="secondary" className="flex-1 h-12 text-base" onClick={silence}>
                      <BellOff className="h-5 w-5 mr-2" /> Silence alarm
                    </Button>
                  )}
                  <Button variant="outline" className="flex-1 h-12 text-base bg-white text-red-700 hover:bg-red-50" onClick={reset}>
                    <ScanLine className="h-5 w-5 mr-2" /> Check another pass
                  </Button>
                </div>
              </div>
            ) : !canAct ? (
              <Card className={cn(pass.status === "out" ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50")}>
                <CardContent className="p-5 text-center space-y-1">
                  <div className="text-lg font-bold">{statusMeta(pass.status).label}</div>
                  <div className="text-sm">
                    {pass.status === "out"
                      ? `Already went out${pass.gate_out_at ? ` at ${format(new Date(pass.gate_out_at), "dd MMM, HH:mm")}` : ""}${pass.released_at ? " (released by a manager)" : ""}. Do not let it out again.`
                      : pass.status === "pending_approval" ? "Not approved yet. The vehicle cannot leave."
                      : pass.status === "draft" ? "This pass has not been submitted. The vehicle cannot leave."
                      : "This pass cannot be used. The vehicle cannot leave on it."}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                {pass.status === "held" && (
                  <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                    This pass is held{pass.hold_note ? `: ${pass.hold_note}` : ""}. {pass.pass_type === "scrap"
                      ? "Weigh again after unloading the extra — or wait for the manager."
                      : "Count again if goods were added or unloaded — or wait for the manager."}
                  </div>
                )}

                <Card>
                  <CardContent className="p-4 space-y-2">
                    <Label htmlFor="gp-vehicle-seen" className="text-sm font-semibold">Vehicle number you see</Label>
                    <Input id="gp-vehicle-seen" value={vehicle} className={cn("h-12 text-lg uppercase",
                      vehicle && (vehicleOk ? "border-emerald-500" : "border-red-500"))}
                      placeholder={pass.vehicle_number ? "Type the number plate" : "Leave blank for hand carry"}
                      onChange={(e) => setVehicle(e.target.value)} />
                    {vehicle && pass.vehicle_number && (
                      <div className={cn("text-sm font-semibold", vehicleOk ? "text-emerald-700" : "text-red-700")}>
                        {vehicleOk ? "Matches the pass" : "Does not match the pass"}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {pass.pass_type === "scrap" ? (
                  <ScrapWeighPanel pass={pass} vehicle={vehicle} vehicleOk={vehicleOk} onDone={(r) => {
                    setResult(r);
                    queryClient.invalidateQueries({ queryKey: ["gate-check-pass", passNumber] });
                    queryClient.invalidateQueries({ queryKey: ["gate-passes"] });
                    queryClient.invalidateQueries({ queryKey: ["gate-pass-approvals"] });
                  }} />
                ) : (
                <>
                {pass.pass_type === "sales" && <StorePassGateNotice pass={pass} onStatus={setSpBlocked} />}
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground px-1">Count each line</div>
                {items.map((i) => {
                  const exp = expectedCount(i);
                  const st = lineState(i.id, exp);
                  return (
                    <Card key={i.id} className={cn("border-2", st === "match" ? "border-emerald-300" : st === "diff" ? "border-red-400" : "")}>
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm">{i.description}</div>
                          <div className="text-xs text-muted-foreground">
                            On pass: {fmtQty(i.quantity)} {i.uom}{i.packages !== null ? ` / ${i.packages} ctn` : ""}
                          </div>
                          <div className="text-xs font-medium">Count in {countUnit(i) === "ctn" ? "cartons" : countUnit(i)}</div>
                          {st === "diff" && (
                            <div className="text-xs font-bold text-red-700 mt-0.5">
                              {Number(counts[i.id]) < exp ? `${fmtQty(exp - Number(counts[i.id]))} short` : `${fmtQty(Number(counts[i.id]) - exp)} over`}
                            </div>
                          )}
                        </div>
                        <Input
                          aria-label={`Counted ${i.description}`}
                          inputMode="decimal"
                          type="number"
                          min="0"
                          className={cn("w-24 h-12 text-center text-lg font-bold",
                            st === "match" ? "border-emerald-600" : st === "diff" ? "border-red-600 text-red-700" : "")}
                          value={counts[i.id] ?? ""}
                          onChange={(e) => setCounts((c) => ({ ...c, [i.id]: e.target.value }))}
                        />
                        {st === "match" && <CheckCircle2 className="h-6 w-6 text-emerald-700 shrink-0" aria-label="Matches" />}
                      </CardContent>
                    </Card>
                  );
                })}

                {allCounted && !goesOut && (
                  <div className="space-y-2">
                    <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex gap-2">
                      <AlertTriangle className="h-5 w-5 shrink-0 text-red-700" />
                      The count or vehicle does not match, so the vehicle cannot go out. Holding the pass tells the office and the manager.
                    </div>
                    <Label htmlFor="gp-guard-note" className="text-sm font-semibold">Note for the manager</Label>
                    <Textarea id="gp-guard-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                )}

                <div className="sticky bottom-0 bg-background/95 backdrop-blur py-3 space-y-2">
                  <Button
                    className={cn("w-full h-14 text-lg font-bold", goesOut ? "bg-emerald-700 hover:bg-emerald-800" : "")}
                    variant={allCounted && !goesOut ? "destructive" : "default"}
                    disabled={!allCounted || check.isPending || (spBlocked && goesOut)}
                    onClick={() => check.mutate()}
                  >
                    {check.isPending && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}
                    {!allCounted ? "Count every line first" : spBlocked && goesOut ? "No store pass · vehicle cannot leave" : goesOut ? "All match · Mark Out" : "Hold vehicle and notify"}
                  </Button>
                  {!allCounted && (
                    <p className="text-xs text-center text-muted-foreground flex items-center justify-center gap-1">
                      <QrCode className="h-3.5 w-3.5" /> Mark Out unlocks only when every line matches.
                    </p>
                  )}
                </div>
                </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
