import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, Loader2, Package, Truck } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ScrapWeighPanel } from "@/components/gate-pass/ScrapWeighPanel";
import { StorePassGateNotice } from "@/components/store-pass/StorePassGateNotice";
import { primeGateAlarm } from "@/lib/gateAlarm";
import {
  PASS_SELECT, REUSE_ALARM_STATUSES, countUnit, errorMessage, expectedCount, gpDb, sortedItems, type GatePass,
} from "@/lib/gatePass";
import { SAY, T, UR, speak, stopSpeaking } from "@/lib/guardUi";
import { BigButton, GoScreen, GuardHeader, NoticeCard, SameDifferent, StopScreen, Stepper, Ur } from "@/components/guard/GuardKit";

const normVehicle = (v: string | null | undefined) => (v ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

type CheckResult = {
  status: "out" | "held";
  vehicle_ok?: boolean;
  mismatches?: { line_no: number; description: string; expected: number; counted: number }[];
  problems?: string[];
  missing_store_pass?: string[];
};

type LineAnswer = { kind: "same" } | { kind: "different"; counted: number };

/**
 * Goods going out, guard version. For the number plate and every line the guard
 * answers one question — same or different — and only on "different" types or
 * counts. GO appears only when everything is the same; otherwise STOP holds the
 * pass and tells the office (the same gate_pass_gate_check call as the office page).
 */
export function GuardGoodsOut({ passNumber, lookupId, onDone }: { passNumber: string; lookupId: number; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [vehicleAnswer, setVehicleAnswer] = useState<"same" | "different" | null>(null);
  const [vehicleTyped, setVehicleTyped] = useState("");
  const [answers, setAnswers] = useState<Record<string, LineAnswer>>({});
  const [result, setResult] = useState<CheckResult | null>(null);
  const [spBlocked, setSpBlocked] = useState(false);
  const [oldPass, setOldPass] = useState(false);
  const decidedRef = useRef(-1);
  const lookupAtRef = useRef(Date.now());

  const { data: pass, isFetching, isFetched, dataUpdatedAt } = useQuery<GatePass | null>({
    queryKey: ["gate-check-pass", passNumber],
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_passes").select(PASS_SELECT).eq("pass_number", passNumber).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    setVehicleAnswer(null); setVehicleTyped(""); setAnswers({}); setResult(null); setSpBlocked(false); setOldPass(false);
    lookupAtRef.current = Date.now();
    primeGateAlarm();
  }, [passNumber, lookupId]);

  // Old pass opened again: red screen + siren, and the attempt is logged (managers told).
  useEffect(() => {
    if (!pass || isFetching || dataUpdatedAt < lookupAtRef.current || decidedRef.current === lookupId) return;
    decidedRef.current = lookupId;
    if (REUSE_ALARM_STATUSES.includes(pass.status)) {
      setOldPass(true);
      gpDb.rpc("gate_pass_log_rescan", { p_id: pass.id });
    } else if (["approved", "held"].includes(pass.status)) {
      speak(SAY.goods);
    } else {
      speak(SAY.notValid);
    }
  }, [pass, isFetching, dataUpdatedAt, lookupId]);

  useEffect(() => () => stopSpeaking(), []);

  const items = pass ? sortedItems(pass).filter((i) => Number(i.quantity) > 0) : [];
  const passHasVehicle = Boolean(pass?.vehicle_number);
  const vehicle = !passHasVehicle ? "" : vehicleAnswer === "same" ? (pass?.vehicle_number ?? "") : vehicleTyped;
  const vehicleAnswered = !passHasVehicle || vehicleAnswer === "same" || (vehicleAnswer === "different" && normVehicle(vehicleTyped).length >= 3);
  const vehicleOk = !passHasVehicle || normVehicle(vehicle) === normVehicle(pass?.vehicle_number);
  const counted = (id: string, exp: number) => {
    const a = answers[id];
    return a ? (a.kind === "same" ? exp : a.counted) : null;
  };
  const allAnswered = items.length > 0 && items.every((i) => answers[i.id]) && vehicleAnswered;
  const allMatch = allAnswered && vehicleOk && items.every((i) => counted(i.id, expectedCount(i)) === expectedCount(i));
  const canAct = Boolean(pass && ["approved", "held"].includes(pass.status));

  const check = useMutation({
    mutationFn: async () => {
      const { data, error } = await gpDb.rpc("gate_pass_gate_check", {
        p_id: pass!.id,
        p_counts: items.map((i) => ({ item_id: i.id, counted: String(counted(i.id, expectedCount(i)) ?? "") })),
        p_vehicle: vehicle,
        p_note: "",
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

  const header = (
    <GuardHeader color="bg-amber-700" icon={<Truck className="h-8 w-8" />} ur={T.goodsOut}
      en={pass ? `${pass.pass_number} · ${pass.party_name} · ${items.length} line${items.length === 1 ? "" : "s"}` : passNumber} onBack={onDone} />
  );

  if (isFetching && !pass) {
    return <>{header}<div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div></>;
  }
  if (isFetched && !pass) {
    return <>{header}<NoticeCard ur={T.notFound} en={`No gate pass ${passNumber}`} onNext={onDone} /></>;
  }
  if (!pass) return header;

  if (oldPass) {
    return (
      <StopScreen title={`${pass.pass_number} · ${pass.party_name}`} siren
        reasonUr={T.oldPaper}
        reasonEn={pass.status === "cancelled" || pass.status === "rejected"
          ? `This pass was ${pass.status}.`
          : `Already used${pass.gate_out_at ? ` — went out ${format(new Date(pass.gate_out_at), "dd MMM, HH:mm")}` : ""}. The office has been told.`}
        onNext={onDone} />
    );
  }

  if (result?.status === "out") {
    return <GoScreen title={`${pass.pass_number} · ${pass.vehicle_number ?? ""}`} onNext={onDone} />;
  }
  if (result?.status === "held") {
    const m = result.mismatches ?? [];
    const first = m[0];
    const reasonUr = result.vehicle_ok === false ? "گاڑی کا نمبر فرق ہے"
      : first ? `${Math.abs(first.counted - first.expected)} ${first.counted < first.expected ? T.short : T.over}`
      : result.problems?.length ? "وزن ٹھیک نہیں" : "گنتی فرق ہے";
    const reasonEn = result.vehicle_ok === false ? "Vehicle does not match the pass · office told"
      : first ? `${first.description}: ${first.counted} counted, ${first.expected} on the paper · office told`
      : (result.problems ?? []).join(" · ") || "Office told";
    return <StopScreen title={`${pass.pass_number} · ${pass.party_name}`} reasonUr={reasonUr} reasonEn={reasonEn} onNext={onDone} />;
  }

  if (!canAct) {
    return (
      <>
        {header}
        <NoticeCard ur={T.notValid}
          en={pass.status === "pending_approval" ? "Not approved yet. The vehicle cannot leave." : pass.status === "draft" ? "Not submitted yet. The vehicle cannot leave." : "This pass cannot be used. Ask the office."}
          onNext={onDone} />
      </>
    );
  }

  return (
    <>
      {header}
      <div className="flex flex-col gap-3 pb-28">
        {pass.status === "held" && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-3 flex gap-2 items-center">
            <AlertTriangle className="h-6 w-6 text-red-700 shrink-0" />
            <Ur ur="یہ گاڑی روکی گئی تھی — دوبارہ گنیں" en={pass.hold_note ? `Held: ${pass.hold_note}` : "Held earlier. Count again or wait for the manager."} size="text-lg" className="text-red-900 items-start text-left" />
          </div>
        )}
        {pass.pass_type === "sales" && <StorePassGateNotice pass={pass} onStatus={setSpBlocked} />}

        {/* Number plate */}
        <section className={cn("bg-white rounded-2xl p-3.5 flex flex-col gap-2.5 border-[3px]",
          !passHasVehicle || vehicleAnswer === "same" ? "border-emerald-500" : vehicleAnswer === "different" ? "border-red-500" : "border-slate-200")}>
          <div className="flex items-center justify-between">
            <div className="text-xl font-bold" style={UR}>{T.plate}</div>
            <div className="text-xs text-muted-foreground font-sans">Number plate</div>
          </div>
          {passHasVehicle ? (
            <>
              <div className="bg-amber-100 border-[3px] border-slate-900 rounded-lg px-3 py-1.5 text-center text-3xl font-bold tracking-[4px] font-sans">{pass.vehicle_number}</div>
              <SameDifferent value={vehicleAnswer} onSame={() => setVehicleAnswer("same")} onDifferent={() => setVehicleAnswer("different")} />
              {vehicleAnswer === "different" && (
                <div className="flex flex-col gap-1">
                  <Ur ur="جو نمبر نظر آ رہا ہے وہ لکھیں" en="Type the plate you see" size="text-base" className="text-red-800" />
                  <input value={vehicleTyped} onChange={(e) => setVehicleTyped(e.target.value.toUpperCase())} autoCapitalize="characters"
                    className="h-14 rounded-xl border-[3px] border-red-500 text-center text-3xl font-bold tracking-[4px] font-sans uppercase" placeholder="ABC-123" />
                </div>
              )}
            </>
          ) : (
            <Ur ur={T.handCarry} en="No vehicle on this pass" size="text-lg" className="text-emerald-800" />
          )}
        </section>

        <div className="flex items-baseline justify-between px-1">
          <div className="text-xl font-bold" style={UR}>{T.countBoxes}</div>
          <div className="text-xs text-muted-foreground font-sans">{items.filter((i) => answers[i.id]).length} of {items.length} answered</div>
        </div>

        {pass.pass_type === "scrap" ? (
          <ScrapWeighPanel pass={pass} vehicle={vehicle} vehicleOk={vehicleOk} onDone={(r) => {
            setResult(r as CheckResult);
            queryClient.invalidateQueries({ queryKey: ["gate-check-pass", passNumber] });
            queryClient.invalidateQueries({ queryKey: ["gate-passes"] });
            queryClient.invalidateQueries({ queryKey: ["gate-pass-approvals"] });
          }} />
        ) : items.map((i, n) => {
          const exp = expectedCount(i);
          const a = answers[i.id];
          const unitUr = countUnit(i) === "ctn" ? T.boxes : T.pieces;
          const c = counted(i.id, exp);
          return (
            <section key={i.id} className={cn("bg-white rounded-2xl p-3.5 flex flex-col gap-2.5 border-[3px]",
              !a ? "border-slate-200" : c === exp ? "border-emerald-600" : "border-red-600")}>
              <div className="flex items-center gap-3">
                <Package className="h-10 w-10 shrink-0 text-slate-800" strokeWidth={1.6} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold leading-tight font-sans">{i.description}</div>
                  <div className="text-xs text-muted-foreground font-sans">Line {n + 1} · {countUnit(i) === "ctn" ? "count cartons" : `count ${i.uom}`}</div>
                </div>
                <div className="flex flex-col items-center bg-slate-900 text-white rounded-xl px-3.5 py-1">
                  <div className="text-4xl font-bold leading-none tabular-nums font-sans">{exp}</div>
                  <div className="text-sm" style={UR}>{unitUr}</div>
                </div>
              </div>
              <SameDifferent value={a ? a.kind : null}
                onSame={() => setAnswers((x) => ({ ...x, [i.id]: { kind: "same" } }))}
                onDifferent={() => setAnswers((x) => ({ ...x, [i.id]: { kind: "different", counted: a?.kind === "different" ? a.counted : exp } }))} />
              {a?.kind === "different" && (
                <>
                  <Stepper value={a.counted} onChange={(v) => setAnswers((x) => ({ ...x, [i.id]: { kind: "different", counted: v } }))} />
                  {a.counted !== exp && (
                    <div className="text-center text-lg font-bold text-red-700" style={UR}>
                      {Math.abs(a.counted - exp)} {a.counted < exp ? T.short : T.over}
                    </div>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>

      {pass.pass_type !== "scrap" && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur p-3 pb-5">
          <div className="max-w-xl mx-auto">
            {!allAnswered ? (
              <BigButton ur={T.answerAll} en={`Answer every line · ${items.filter((i) => answers[i.id]).length}/${items.length}`} color="bg-slate-300 text-slate-700" shadow="" disabled />
            ) : spBlocked ? (
              <BigButton ur={T.storeBlocked} en="No store pass · vehicle cannot leave" color="bg-red-700 text-white" shadow="" disabled />
            ) : allMatch ? (
              <BigButton ur={T.go} en="All same · GO" icon={check.isPending ? <Loader2 className="h-8 w-8 animate-spin" /> : undefined}
                color="bg-emerald-700 text-white" shadow="shadow-[0_6px_0_#14532d]" className="h-[84px]" disabled={check.isPending} onClick={() => check.mutate()} />
            ) : (
              <BigButton ur={T.stopAndTell} en="Count is different · STOP and tell office" icon={check.isPending ? <Loader2 className="h-8 w-8 animate-spin" /> : <AlertTriangle className="h-8 w-8" />}
                color="bg-red-700 text-white" shadow="shadow-[0_6px_0_#7f1d1d]" className="h-[84px]" disabled={check.isPending} onClick={() => check.mutate()} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
