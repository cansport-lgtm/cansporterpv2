import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { ArrowLeft, CheckCircle2, Delete, PhoneCall, ScanLine, Siren, Volume2, VolumeX } from "lucide-react";

import { cn } from "@/lib/utils";
import { startGateAlarm, stopGateAlarm } from "@/lib/gateAlarm";
import { OFFICE_PHONE, OFFICE_PHONE_TEL, SAY, T, UR, beepOk, buzzStop, isVoiceMuted, setVoiceMuted, speak, stopSpeaking } from "@/lib/guardUi";

// Building blocks for the guard's screens: one job per screen, Urdu large,
// English small, pictures and colour, big thumb-sized buttons.

/** Urdu line with its small English line under it. */
export function Ur({ ur, en, size = "text-2xl", enClass = "text-xs opacity-80", className }: {
  ur: string; en?: string; size?: string; enClass?: string; className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      <div className={cn("font-bold", size)} style={UR}>{ur}</div>
      {en && <div className={cn("font-sans", enClass)}>{en}</div>}
    </div>
  );
}

/** Coloured sub-header under the dark guard bar: back arrow, icon, Urdu title, English line, mute. */
export function GuardHeader({ color, icon, ur, en, onBack }: {
  color: string; icon: React.ReactNode; ur: string; en?: string; onBack?: () => void;
}) {
  const [muted, setMuted] = useState(isVoiceMuted());
  return (
    <div className={cn("-mx-3 sm:-mx-4 -mt-3 sm:-mt-4 mb-3 px-3 py-2.5 flex items-center gap-3 text-white", color)}>
      {onBack ? (
        <button type="button" aria-label="Back" onClick={onBack} className="h-11 w-11 rounded-full bg-black/25 flex items-center justify-center shrink-0">
          <ArrowLeft className="h-6 w-6" />
        </button>
      ) : null}
      <div className="shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xl font-bold leading-snug" style={UR}>{ur}</div>
        {en && <div className="text-[11px] opacity-85 truncate">{en}</div>}
      </div>
      <button type="button" aria-label={muted ? "Turn voice on" : "Turn voice off"}
        onClick={() => { const m = !muted; setVoiceMuted(m); setMuted(m); }}
        className="h-11 w-11 rounded-full bg-black/25 flex items-center justify-center shrink-0">
        {muted ? <VolumeX className="h-6 w-6" /> : <Volume2 className="h-6 w-6" />}
      </button>
    </div>
  );
}

/** A big full-width action: Urdu on top, English under, optional icon. */
export function BigButton({ ur, en, icon, color = "bg-primary text-primary-foreground", shadow = "shadow-[0_6px_0_rgba(0,0,0,0.25)]", className, disabled, onClick, href, type = "button" }: {
  ur: string; en?: string; icon?: React.ReactNode; color?: string; shadow?: string; className?: string;
  disabled?: boolean; onClick?: () => void; href?: string; type?: "button" | "submit";
}) {
  const inner = (
    <>
      {icon}
      <div className="flex flex-col items-center leading-tight">
        <div className="text-2xl font-bold" style={UR}>{ur}</div>
        {en && <div className="text-[11px] opacity-85">{en}</div>}
      </div>
    </>
  );
  const cls = cn("w-full h-[76px] rounded-2xl flex items-center justify-center gap-3 px-4 select-none active:translate-y-[2px]",
    color, disabled ? "opacity-50 pointer-events-none" : shadow, className);
  if (href) return <a href={href} className={cls}>{inner}</a>;
  return <button type={type} disabled={disabled} onClick={onClick} className={cls}>{inner}</button>;
}

/** Same / Different pair used for the number plate and every line. */
export function SameDifferent({ value, onSame, onDifferent, differentUr = T.different }: {
  value: "same" | "different" | null; onSame: () => void; onDifferent: () => void; differentUr?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <button type="button" onClick={onSame}
        className={cn("h-14 rounded-xl flex items-center justify-center gap-2 text-xl font-bold border-[3px]",
          value === "same" ? "bg-emerald-700 border-emerald-700 text-white" : "bg-white border-emerald-700 text-emerald-800")}>
        <CheckCircle2 className="h-6 w-6" /><span style={UR}>{T.same}</span>
      </button>
      <button type="button" onClick={onDifferent}
        className={cn("h-14 rounded-xl flex items-center justify-center gap-2 text-xl font-bold border-[3px]",
          value === "different" ? "bg-red-700 border-red-700 text-white" : "bg-white border-red-700 text-red-800")}>
        <span className="text-2xl leading-none">✕</span><span style={UR}>{differentUr}</span>
      </button>
    </div>
  );
}

/** Big minus / plus counter. */
export function Stepper({ value, onChange, min = 0 }: { value: number; onChange: (n: number) => void; min?: number }) {
  return (
    <div className="flex items-center justify-between bg-red-50 rounded-xl p-2">
      <button type="button" aria-label="Less" onClick={() => onChange(Math.max(min, value - 1))}
        className="w-16 h-14 rounded-xl bg-slate-900 text-white text-3xl font-bold">−</button>
      <div className="flex flex-col items-center">
        <div className="text-4xl font-bold leading-none text-red-700 tabular-nums">{value}</div>
        <div className="text-sm text-red-700" style={UR}>{T.iCounted}</div>
      </div>
      <button type="button" aria-label="More" onClick={() => onChange(value + 1)}
        className="w-16 h-14 rounded-xl bg-slate-900 text-white text-3xl font-bold">+</button>
    </div>
  );
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Digits-only keypad with a prefix badge and a green confirm key. */
export function Keypad({ prefix, value, onChange, onConfirm, prefixPicker }: {
  prefix: string; value: string; onChange: (v: string) => void; onConfirm: () => void; prefixPicker?: React.ReactNode;
}) {
  const press = (d: string) => { if (value.length < 6) onChange(value + d); };
  return (
    <div className="flex flex-col gap-3 flex-1">
      {prefixPicker}
      <div className="bg-white rounded-2xl border-2 border-slate-300 h-[84px] flex items-center justify-center gap-2 font-sans">
        <span className="text-xl font-bold text-slate-400">{prefix}-</span>
        <span className="text-[42px] font-bold tracking-[6px] tabular-nums">
          {value}<span className="text-slate-300">{"_".repeat(Math.max(0, 3 - value.length))}</span>
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2.5 flex-1 min-h-[300px]">
        {KEYS.map((k) => (
          <button key={k} type="button" onClick={() => press(k)}
            className="rounded-2xl bg-white shadow-[0_3px_0_#cbd5e1] text-4xl font-bold font-sans active:translate-y-[2px]">{k}</button>
        ))}
        <button type="button" aria-label="Delete last digit" onClick={() => onChange(value.slice(0, -1))}
          className="rounded-2xl bg-slate-200 shadow-[0_3px_0_#94a3b8] flex items-center justify-center active:translate-y-[2px]">
          <Delete className="h-9 w-9" />
        </button>
        <button type="button" onClick={() => press("0")}
          className="rounded-2xl bg-white shadow-[0_3px_0_#cbd5e1] text-4xl font-bold font-sans active:translate-y-[2px]">0</button>
        <button type="button" aria-label="Open" disabled={!value} onClick={onConfirm}
          className={cn("rounded-2xl flex items-center justify-center text-white active:translate-y-[2px]",
            value ? "bg-emerald-700 shadow-[0_3px_0_#14532d]" : "bg-emerald-700/40")}>
          <CheckCircle2 className="h-10 w-10" />
        </button>
      </div>
    </div>
  );
}

/** Full-screen QR camera. Calls onText with the decoded text, onCancel to leave. */
export function Scanner({ onText, onCancel, hintUr = T.scan, hintEn = "Point the camera at the QR code" }: {
  onText: (text: string) => void; onCancel: () => void; hintUr?: string; hintEn?: string;
}) {
  const ref = useRef<Html5Qrcode | null>(null);
  const [failed, setFailed] = useState(false);
  const id = "guard-qr-scanner";
  useEffect(() => {
    let alive = true;
    (async () => {
      await new Promise((r) => setTimeout(r, 60));
      try {
        const s = new Html5Qrcode(id);
        ref.current = s;
        await s.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 260, height: 260 } },
          (text) => { if (!alive) return; alive = false; s.stop().catch(() => {}); ref.current = null; onText(text); },
          () => {});
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; ref.current?.stop().catch(() => {}); ref.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="flex flex-col gap-3">
      <Ur ur={hintUr} en={hintEn} size="text-3xl" className="text-slate-800" />
      <div id={id} className="w-full overflow-hidden rounded-2xl bg-black min-h-[320px]" />
      {failed && (
        <div className="rounded-xl bg-amber-50 border border-amber-300 p-3 text-center">
          <Ur ur="کیمرہ نہیں چلا — نمبر لکھیں" en="Camera not available — type the number instead" size="text-xl" className="text-amber-900" />
        </div>
      )}
      <BigButton ur={T.back} en="Back" color="bg-white text-slate-800 border-2 border-slate-300" shadow="" onClick={onCancel} />
    </div>
  );
}

/** Whole screen green: let it go. */
export function GoScreen({ title, sub, nextUr = T.next, nextEn = "Next · scan again", onNext, mainUr = T.go, mainEn = T.goSub, sayText = SAY.go }: {
  title?: string; sub?: string; nextUr?: string; nextEn?: string; onNext: () => void; mainUr?: string; mainEn?: string; sayText?: string;
}) {
  useEffect(() => { beepOk(); speak(sayText); return () => stopSpeaking(); }, [sayText]);
  return (
    <div className="fixed inset-0 z-40 bg-emerald-700 text-white flex flex-col items-center justify-between p-6 pt-10">
      <div className="text-sm font-sans text-emerald-100">{title}</div>
      <div className="flex flex-col items-center gap-5">
        <div className="h-52 w-52 rounded-full bg-white flex items-center justify-center shadow-[0_0_0_18px_#16a34a]">
          <CheckCircle2 className="h-36 w-36 text-emerald-700" strokeWidth={2.5} />
        </div>
        <div className="text-6xl font-bold text-center" style={UR}>{mainUr}</div>
        <div className="text-lg text-emerald-100 text-center font-sans">{mainEn}</div>
        {sub && <div className="text-sm text-emerald-100 text-center font-sans">{sub}</div>}
      </div>
      <BigButton ur={nextUr} en={nextEn} icon={<ScanLine className="h-8 w-8" />} color="bg-white text-emerald-800" shadow="shadow-[0_6px_0_#14532d]" className="h-[84px]" onClick={onNext} />
    </div>
  );
}

/** Whole screen red: stop. `siren` keeps the 20 s siren of the old-pass alarm; otherwise a short buzz. */
export function StopScreen({ title, reasonUr, reasonEn, siren = false, onNext, nextUr = T.next, nextEn = "Next vehicle" }: {
  title?: string; reasonUr: string; reasonEn?: string; siren?: boolean; onNext: () => void; nextUr?: string; nextEn?: string;
}) {
  const [sounding, setSounding] = useState(siren);
  useEffect(() => {
    if (siren) startGateAlarm(); else buzzStop();
    speak(siren ? SAY.oldPaper : SAY.stop);
    return () => { stopGateAlarm(); stopSpeaking(); };
  }, [siren]);
  return (
    <div className="fixed inset-0 z-40 bg-red-700 text-white flex flex-col items-center justify-between p-6 pt-10 overflow-y-auto">
      <div className="text-sm font-sans text-red-100">{title}</div>
      <div className="flex flex-col items-center gap-4 w-full">
        <div className="h-52 w-52 rounded-full bg-white flex items-center justify-center shadow-[0_0_0_18px_#dc2626]">
          <Siren className="h-32 w-32 text-red-700" strokeWidth={1.8} />
        </div>
        <div className="text-6xl font-bold text-center" style={UR}>{T.stop}</div>
        <div className="text-lg text-red-100 text-center font-sans">{T.stopSub}</div>
        <div className="w-full rounded-2xl bg-red-900/70 p-3 flex flex-col items-center gap-1">
          <div className="text-xl font-bold text-center" style={UR}>{reasonUr}</div>
          {reasonEn && <div className="text-xs text-red-100 text-center font-sans">{reasonEn}</div>}
        </div>
      </div>
      <div className="w-full flex flex-col gap-2.5">
        <BigButton ur={T.callOffice} en={`CALL OFFICE · ${OFFICE_PHONE}`} icon={<PhoneCall className="h-8 w-8" />} color="bg-white text-red-800" shadow="shadow-[0_6px_0_#7f1d1d]" className="h-[84px]" href={OFFICE_PHONE_TEL} />
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" disabled={!sounding} onClick={() => { stopGateAlarm(); setSounding(false); }}
            className={cn("h-14 rounded-xl border-2 border-red-200 bg-red-900 text-white text-xl font-bold flex items-center justify-center gap-2", !sounding && "opacity-50")}>
            <VolumeX className="h-6 w-6" /><span style={UR}>{T.silence}</span>
          </button>
          <button type="button" onClick={onNext} className="h-14 rounded-xl border-2 border-red-200 bg-red-900 text-white text-xl font-bold flex flex-col items-center justify-center leading-tight">
            <span style={UR}>{nextUr}</span><span className="text-[10px] font-sans opacity-80">{nextEn}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Amber full card for "this paper is not valid right now" and "not found". */
export function NoticeCard({ ur, en, onNext }: { ur: string; en?: string; onNext: () => void }) {
  return (
    <div className="rounded-2xl border-[3px] border-amber-400 bg-amber-50 p-5 flex flex-col items-center gap-4">
      <Ur ur={ur} en={en} size="text-3xl" className="text-amber-900" />
      <BigButton ur={T.next} en="Next · scan again" color="bg-amber-700 text-white" shadow="shadow-[0_6px_0_#78350f]" onClick={onNext} />
    </div>
  );
}
