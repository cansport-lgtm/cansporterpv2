import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { IdCard, Package, ScanLine, Truck, UserRound } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { GuardShell } from "@/components/gate-pass/GuardShell";
import { InwardGatePanel } from "@/components/gate-pass/InwardGatePanel";
import { PersonGatePanel, type PersonLookup } from "@/components/person-gate-pass/PersonGatePanel";
import { GuardGoodsOut } from "@/components/guard/GuardGoodsOut";
import { GuardHeader, Keypad, Scanner, Ur } from "@/components/guard/GuardKit";
import { primeGateAlarm, stopGateAlarm } from "@/lib/gateAlarm";
import { normalizePassNumber } from "@/lib/gatePass";
import { isInwardNumber, normalizeInwardNumber } from "@/lib/gateInward";
import {
  PERSON_PASS_VARIANTS, STAFF_PASS, WORKER_PASS, detectPersonPassVariant, isFullPassNumber, normalizePersonPassNumber,
  type PersonPassVariant,
} from "@/lib/personGatePass";
import { SAY, T, UR, speak, stopSpeaking } from "@/lib/guardUi";

type Prefix = "GP" | "GIN" | "LGP" | "SGP";
type Screen =
  | { kind: "home" }
  | { kind: "scan" }
  | { kind: "keypad"; prefix: Prefix }
  | { kind: "goods"; number: string }
  | { kind: "person"; variant: PersonPassVariant; lookup: PersonLookup }
  | { kind: "inward"; number: string };

const PREFIXES: { value: Prefix; ur: string; en: string; icon: React.ReactNode; ring: string; text: string }[] = [
  { value: "GP", ur: T.goodsOut, en: "GP", icon: <Truck className="h-8 w-8" />, ring: "border-amber-500 bg-amber-50", text: "text-amber-800" },
  { value: "GIN", ur: T.goodsBack, en: "GIN", icon: <Package className="h-8 w-8" />, ring: "border-teal-600 bg-teal-50", text: "text-teal-800" },
  { value: "LGP", ur: T.worker, en: "LGP", icon: <UserRound className="h-8 w-8" />, ring: "border-violet-600 bg-violet-50", text: "text-violet-800" },
  { value: "SGP", ur: T.staff, en: "SGP", icon: <IdCard className="h-8 w-8" />, ring: "border-slate-500 bg-slate-100", text: "text-slate-700" },
];

/**
 * Gate Check for the gate keeper: one big SCAN button; the QR code decides what the
 * paper is (GP / LGP / SGP / GIN). No tabs, digits-only keypad, Urdu first, voice prompts.
 * The office keeps the detailed page (GateCheckPage).
 */
export default function GuardGateCheckPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { roles } = useAuth();
  const canCheck = roles.some((r) => ["gate_security", "gate_pass_manager", "super_admin"].includes(r.role));
  const [screen, setScreen] = useState<Screen>({ kind: "home" });
  const [digits, setDigits] = useState("");
  const [lookupId, setLookupId] = useState(0);
  const lookupAtRef = useRef(0);

  useEffect(() => {
    if (screen.kind === "home") speak(SAY.home);
    if (screen.kind === "keypad") speak(SAY.keypad);
    if (screen.kind === "person") speak(SAY.person);
    if (screen.kind === "inward") speak(SAY.inward);
    return () => stopSpeaking();
  }, [screen.kind]);

  const home = () => { stopGateAlarm(); stopSpeaking(); setDigits(""); setScreen({ kind: "home" }); };

  /** Open whatever the text names: a scanned QR, or prefix + typed digits. */
  const lookUp = (raw: string, fallback: Prefix = "GP") => {
    const text = raw.trim();
    if (!text) return;
    primeGateAlarm();
    stopGateAlarm();
    lookupAtRef.current = Date.now();
    setLookupId((x) => x + 1);
    if (isInwardNumber(text) || (fallback === "GIN" && !/^(GP|LGP|SGP)-?\d+$/i.test(text))) {
      const n = normalizeInwardNumber(text);
      queryClient.invalidateQueries({ queryKey: ["gate-check-inward", n] });
      setScreen({ kind: "inward", number: n });
      return;
    }
    const fallbackVariant = fallback === "LGP" ? WORKER_PASS : fallback === "SGP" ? STAFF_PASS : null;
    const variant = detectPersonPassVariant(text) ?? (fallbackVariant && !/^GP-?\d+$/i.test(text) ? fallbackVariant : null);
    if (variant) {
      const n = normalizePersonPassNumber(variant, text);
      const lookup: PersonLookup = isFullPassNumber(variant, n) ? { number: n } : { code: n };
      PERSON_PASS_VARIANTS.forEach((v) => queryClient.invalidateQueries({ queryKey: [`gate-check-${v.key}-pass`] }));
      setScreen({ kind: "person", variant, lookup });
      return;
    }
    const n = normalizePassNumber(text);
    if (!n) return;
    queryClient.invalidateQueries({ queryKey: ["gate-check-pass", n] });
    setScreen({ kind: "goods", number: n });
  };

  if (!canCheck) {
    return <GuardShell><div className="p-8 text-center text-muted-foreground">Only gate security or a gate pass manager can use Gate Check.</div></GuardShell>;
  }

  return (
    <GuardShell title={T.gateCheck}>
      {screen.kind === "home" && (
        <div className="flex flex-col gap-4">
          <button type="button" onClick={() => { primeGateAlarm(); setScreen({ kind: "scan" }); }}
            className="w-full h-[250px] rounded-[28px] bg-blue-700 text-white flex flex-col items-center justify-center gap-2 shadow-[0_8px_0_#1e3a8a] active:translate-y-[3px]">
            <ScanLine className="h-24 w-24" strokeWidth={1.6} />
            <div className="text-[40px] font-bold leading-tight" style={UR}>{T.scan}</div>
            <div className="text-sm text-blue-100 font-sans">{T.scanSub}</div>
          </button>

          <div className="flex items-center gap-3 text-slate-500">
            <div className="flex-1 h-px bg-slate-300" />
            <div className="text-lg" style={UR}>{T.noPaper}</div>
            <div className="flex-1 h-px bg-slate-300" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <HomeTile ur={T.goodsOut} en="Goods going OUT" ring="border-amber-500" icon={<Truck className="h-14 w-14 text-amber-700" strokeWidth={1.6} />}
              onClick={() => setScreen({ kind: "keypad", prefix: "GP" })} />
            <HomeTile ur={T.goodsBack} en="Goods coming BACK" ring="border-teal-600" icon={<Package className="h-14 w-14 text-teal-700" strokeWidth={1.6} />}
              onClick={() => navigate("/gate-pass/inward/new")} />
            <HomeTile ur={T.worker} en="Worker pass" ring="border-violet-600" icon={<UserRound className="h-14 w-14 text-violet-700" strokeWidth={1.6} />}
              onClick={() => setScreen({ kind: "keypad", prefix: "LGP" })} />
            <HomeTile ur={T.staff} en="Staff pass" ring="border-slate-500" icon={<IdCard className="h-14 w-14 text-slate-600" strokeWidth={1.6} />}
              onClick={() => setScreen({ kind: "keypad", prefix: "SGP" })} />
          </div>
        </div>
      )}

      {screen.kind === "scan" && (
        <Scanner onText={(t) => lookUp(t)} onCancel={home} />
      )}

      {screen.kind === "keypad" && (
        <div className="flex flex-col gap-3 min-h-[calc(100vh-80px)]">
          <GuardHeader color="bg-slate-800" icon={<span className="text-2xl font-bold font-sans">123</span>} ur={T.typeNumber} en="Type the number on the paper" onBack={home} />
          <Keypad prefix={screen.prefix} value={digits} onChange={setDigits}
            onConfirm={() => { const d = digits; setDigits(""); lookUp(`${screen.prefix}-${d}`, screen.prefix); }}
            prefixPicker={
              <div className="grid grid-cols-4 gap-2">
                {PREFIXES.map((p) => (
                  <button key={p.value} type="button" aria-label={p.en} aria-pressed={screen.prefix === p.value}
                    onClick={() => setScreen({ kind: "keypad", prefix: p.value })}
                    className={cn("h-[74px] rounded-2xl border-[3px] flex flex-col items-center justify-center gap-0.5",
                      screen.prefix === p.value ? p.ring : "border-slate-200 bg-white")}>
                    <span className={cn(screen.prefix === p.value ? p.text : "text-slate-500")}>{p.icon}</span>
                    <span className="text-[11px] font-bold font-sans text-slate-600">{p.en}</span>
                  </button>
                ))}
              </div>
            } />
        </div>
      )}

      {screen.kind === "goods" && (
        <GuardGoodsOut passNumber={screen.number} lookupId={lookupId} onDone={home} />
      )}

      {screen.kind === "person" && (
        <div className="flex flex-col gap-3">
          <GuardHeader color={screen.variant.key === "staff" ? "bg-slate-700" : "bg-violet-700"}
            icon={screen.variant.key === "staff" ? <IdCard className="h-8 w-8" /> : <UserRound className="h-8 w-8" />}
            ur={screen.variant.key === "staff" ? T.staff : T.worker} en={screen.lookup.number ?? screen.lookup.code} onBack={home} />
          <Ur ur={T.lookPhoto} en="Compare the photo with the person" size="text-lg" className="text-slate-700" />
          <PersonGatePanel key={screen.variant.key} variant={screen.variant} lookup={screen.lookup} lookupId={lookupId} lookupAt={lookupAtRef.current} onReset={home} />
        </div>
      )}

      {screen.kind === "inward" && (
        <div className="flex flex-col gap-3">
          <GuardHeader color="bg-teal-700" icon={<Package className="h-8 w-8" />} ur={T.goodsBack} en={screen.number} onBack={home} />
          <InwardGatePanel number={screen.number} lookupId={lookupId} onReset={home} />
        </div>
      )}
    </GuardShell>
  );
}

function HomeTile({ ur, en, ring, icon, onClick }: { ur: string; en: string; ring: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("h-[150px] rounded-[22px] bg-white border-[3px] flex flex-col items-center justify-center gap-1 active:translate-y-[2px]", ring)}>
      {icon}
      <div className="text-2xl font-bold leading-tight" style={UR}>{ur}</div>
      <div className="text-xs text-slate-500 font-sans">{en}</div>
    </button>
  );
}
