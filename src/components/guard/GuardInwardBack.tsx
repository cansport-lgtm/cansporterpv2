import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Camera, CheckCircle2, Loader2, Package, Save } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { GuardShell } from "@/components/gate-pass/GuardShell";
import { PhotoInput } from "@/components/gate-pass/PhotoInput";
import { BigButton, GoScreen, GuardHeader, Keypad, NoticeCard, SameDifferent, Scanner, Ur } from "@/components/guard/GuardKit";
import { errorMessage, normalizePassNumber } from "@/lib/gatePass";
import { giDb } from "@/lib/gateInward";
import { SAY, T, UR, speak, stopSpeaking } from "@/lib/guardUi";

type OpenPass = {
  id: string; pass_number: string; pass_type: string; status: string; party_name: string;
  vehicle_number: string | null; driver_name: string | null; process_name: string | null;
  expected_return_date: string | null; gate_out_at: string | null; at_gate_count: number;
};

/**
 * Goods coming back, guard version: scan the old GP slip (or type its number), say
 * whether it is the same vehicle, take one photo, save. The pass itself decides the
 * type (returnable back or job work back); the office keeps the full form.
 */
export function GuardInwardBack() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [step, setStep] = useState<"scan" | "keypad" | "form">("scan");
  const [digits, setDigits] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [vehicleAnswer, setVehicleAnswer] = useState<"same" | "different" | null>(null);
  const [vehicleTyped, setVehicleTyped] = useState("");
  const [photo, setPhoto] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => { speak(step === "form" ? SAY.backVehicle : SAY.back); return () => stopSpeaking(); }, [step]);

  const { data: passes = [], isFetching, isFetched } = useQuery<OpenPass[]>({
    queryKey: ["gate-inward-open-passes", query],
    enabled: query !== null,
    queryFn: async () => {
      const { data, error } = await giDb.rpc("gate_inward_open_passes", { p_search: query });
      if (error) throw error;
      return data ?? [];
    },
  });
  const pass = passes.find((p) => p.pass_number === query) ?? (passes.length === 1 ? passes[0] : null);

  const open = (raw: string) => {
    const n = normalizePassNumber(raw);
    setVehicleAnswer(null); setVehicleTyped(""); setPhoto("");
    setQuery(n);
    setStep("form");
  };

  const vehicle = !pass ? "" : vehicleAnswer === "same" ? (pass.vehicle_number || "HAND CARRY") : vehicleTyped;
  const vehicleOk = vehicleAnswer === "same" || (vehicleAnswer === "different" && vehicleTyped.replace(/[^A-Za-z0-9]/g, "").length >= 3);

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await giDb.rpc("gate_inward_save", {
        p_id: null,
        p_data: {
          entry_kind: pass!.pass_type === "job_work" ? "job_work_return" : "returnable_return",
          gate_pass_id: pass!.id,
          vehicle_number: vehicle,
          challan_photo_path: photo,
        },
      });
      if (error) throw error;
      const { data: row } = await giDb.from("gate_inward_entries").select("entry_number").eq("id", data).maybeSingle();
      return (row?.entry_number as string) ?? "";
    },
    onSuccess: (n) => {
      queryClient.invalidateQueries({ queryKey: ["gate-inward"] });
      queryClient.invalidateQueries({ queryKey: ["gate-inward-open-passes"] });
      setSaved(n);
    },
    onError: (e) => toast({ title: "Could not save", description: errorMessage(e), variant: "destructive" }),
  });

  const home = () => navigate("/gate-pass/check");

  if (saved) {
    return <GoScreen title={saved} mainUr={T.saved} mainEn="SAVED · the store will count it" nextUr={T.next} nextEn="Back to Gate Check" onNext={home} />;
  }

  return (
    <GuardShell title={T.goodsCameBack}>
      <GuardHeader color="bg-teal-700" icon={<Package className="h-8 w-8" />} ur={T.goodsCameBack} en="Goods coming back · 3 steps"
        onBack={step === "scan" ? home : () => { setStep("scan"); setQuery(null); }} />

      {step === "scan" && (
        <div className="flex flex-col gap-3">
          <Scanner onText={open} onCancel={home} hintUr={T.scannedOld.replace(" ہوا", " کریں")} hintEn="Scan the QR on the OLD gate pass" />
          <BigButton ur={T.typeNumber} en="Or type its number" color="bg-white text-slate-800 border-2 border-slate-300" shadow="" onClick={() => setStep("keypad")} />
        </div>
      )}

      {step === "keypad" && (
        <div className="flex flex-col gap-3 min-h-[60vh]">
          <Keypad prefix="GP" value={digits} onChange={setDigits} onConfirm={() => { const d = digits; setDigits(""); open(`GP-${d}`); }} />
        </div>
      )}

      {step === "form" && (
        <div className="flex flex-col gap-3 pb-28">
          {/* 1 — the old paper */}
          <Step n={1} ur={T.scannedOld} en={isFetching ? "Looking…" : pass ? "Found" : "Not found"} done={Boolean(pass)}>
            {isFetching && <div className="flex justify-center py-4"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>}
            {isFetched && !isFetching && !pass && (
              <NoticeCard ur={T.notFound} en={`${query}: no returnable or job-work pass still outside. Ask the office.`} onNext={() => { setStep("scan"); setQuery(null); }} />
            )}
            {pass && (
              <div className="bg-emerald-50 rounded-xl p-3 flex flex-col gap-1 font-sans">
                <div className="flex justify-between items-baseline">
                  <span className="text-xl font-bold">{pass.pass_number}</span>
                  <span className="text-xs font-bold text-emerald-800">{pass.pass_type === "job_work" ? "Job work" : "Returnable"}{pass.gate_out_at ? ` · out ${format(new Date(pass.gate_out_at), "dd MMM")}` : ""}</span>
                </div>
                <div className="text-base">{pass.party_name}{pass.process_name ? ` · ${pass.process_name}` : ""}</div>
                {pass.expected_return_date && <div className="text-xs text-slate-600">Due back {format(new Date(pass.expected_return_date), "dd MMM yyyy")}</div>}
                {pass.at_gate_count > 0 && <div className="text-xs text-amber-800">{pass.at_gate_count} vehicle(s) already recorded at the gate for this pass</div>}
              </div>
            )}
          </Step>

          {/* 2 — same vehicle? */}
          {pass && (
            <Step n={2} ur={T.sameVehicleQ} en="Same vehicle?" done={vehicleOk} active>
              {pass.vehicle_number ? (
                <div className="bg-amber-100 border-[3px] border-slate-900 rounded-lg px-3 py-1 text-center text-3xl font-bold tracking-[4px] font-sans">{pass.vehicle_number}</div>
              ) : (
                <Ur ur="کاغذ پر گاڑی نہیں لکھی" en="No vehicle on the pass · hand carry" size="text-base" className="text-slate-700" />
              )}
              <SameDifferent value={vehicleAnswer} onSame={() => { setVehicleAnswer("same"); speak(SAY.backPhoto); }} onDifferent={() => setVehicleAnswer("different")} differentUr={T.otherVehicle} />
              {vehicleAnswer === "different" && (
                <input value={vehicleTyped} onChange={(e) => setVehicleTyped(e.target.value.toUpperCase())} autoCapitalize="characters" placeholder="ABC-123"
                  className="h-14 rounded-xl border-[3px] border-slate-500 text-center text-3xl font-bold tracking-[4px] font-sans uppercase" />
              )}
            </Step>
          )}

          {/* 3 — photo */}
          {pass && vehicleOk && (
            <Step n={3} ur={T.takePhoto} en="Paper + goods" done={Boolean(photo)} active>
              <PhotoInput id="guard-inward-photo" label={T.openCamera} folder="inward-challan" value={photo} onChange={setPhoto} />
              {!photo && <div className="flex items-center justify-center gap-2 text-slate-500 text-sm font-sans"><Camera className="h-4 w-4" /> one photo of the old pass and the goods</div>}
            </Step>
          )}
        </div>
      )}

      {step === "form" && pass && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur p-3 pb-5">
          <div className="max-w-xl mx-auto">
            <BigButton ur={T.save} en="SAVE · store will count it" icon={save.isPending ? <Loader2 className="h-8 w-8 animate-spin" /> : <Save className="h-8 w-8" />}
              color="bg-emerald-700 text-white" shadow="shadow-[0_6px_0_#14532d]" className="h-[84px]"
              disabled={!vehicleOk || save.isPending} onClick={() => save.mutate()} />
          </div>
        </div>
      )}
    </GuardShell>
  );
}

function Step({ n, ur, en, done, active, children }: { n: number; ur: string; en?: string; done?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <section className={cn("bg-white rounded-2xl p-3.5 flex flex-col gap-2.5 border-[3px]", done ? "border-emerald-600" : active ? "border-teal-600" : "border-slate-200")}>
      <div className="flex items-center gap-2.5">
        <div className={cn("h-9 w-9 rounded-full text-white flex items-center justify-center text-xl font-bold font-sans", done ? "bg-emerald-700" : active ? "bg-teal-700" : "bg-slate-500")}>{n}</div>
        <div className="flex-1 text-xl font-bold" style={UR}>{ur}</div>
        {done ? <CheckCircle2 className="h-7 w-7 text-emerald-700" /> : en ? <div className="text-xs text-muted-foreground font-sans">{en}</div> : null}
      </div>
      {children}
    </section>
  );
}
