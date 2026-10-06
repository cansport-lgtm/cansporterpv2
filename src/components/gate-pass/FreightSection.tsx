import { useQuery } from "@tanstack/react-query";
import { Truck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { gpDb } from "@/lib/gatePass";
import {
  KINDS, MODES, PAYERS, fmtRs, kindLabel, modeLabel,
  type FreightMode, type FreightPayer, type GatePassFreight, type Transporter, type TransporterKind,
} from "@/lib/gatePassFreight";

export type FreightFormState = {
  payer: FreightPayer | "";
  mode: FreightMode | "";
  transporter_id: string;      // "" = none picked
  new_name: string;            // typed when transporter_id === NEW
  new_kind: TransporterKind;
  new_phone: string;
  amount: string;
  booking_ref: string;
  note: string;
};

export const NEW_TRANSPORTER = "__new__";

export const emptyFreight = (): FreightFormState => ({
  payer: "", mode: "", transporter_id: "", new_name: "", new_kind: "contractor", new_phone: "",
  amount: "", booking_ref: "", note: "",
});

export const freightFromRow = (f: GatePassFreight | null | undefined): FreightFormState =>
  f
    ? {
        payer: f.payer, mode: f.mode ?? "", transporter_id: f.transporter_id ?? "",
        new_name: f.transporter_id ? "" : f.transporter_name ?? "", new_kind: "contractor", new_phone: "",
        amount: f.amount === null || f.amount === undefined ? "" : String(f.amount),
        booking_ref: f.booking_ref ?? "", note: f.note ?? "",
      }
    : emptyFreight();

/** What gate_pass_freight_save (via gate_pass_save's p_data.freight) expects. */
export const freightPayload = (s: FreightFormState, extra: Record<string, unknown> = {}) => ({
  payer: s.payer,
  mode: s.payer === "company" ? s.mode : null,
  transporter_id: s.payer === "company" && s.transporter_id && s.transporter_id !== NEW_TRANSPORTER ? s.transporter_id : null,
  transporter_name: s.payer === "company" && s.transporter_id === NEW_TRANSPORTER ? s.new_name : null,
  transporter_kind: s.transporter_id === NEW_TRANSPORTER ? s.new_kind : null,
  transporter_phone: s.transporter_id === NEW_TRANSPORTER ? s.new_phone : null,
  amount: s.payer === "company" ? s.amount : null,
  booking_ref: s.booking_ref,
  note: s.note,
  ...extra,
});

export function useTransporters(activeOnly = true) {
  return useQuery<Transporter[]>({
    queryKey: ["gate-pass-transporters", activeOnly],
    queryFn: async () => {
      let q = gpDb.from("gate_pass_transporters").select("*").order("name");
      if (activeOnly) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * The Freight section of a sales gate pass: who pays, how the goods go, which
 * transporter and how much. `asCard` false renders only the fields (dialogs).
 */
export function FreightSection({
  value, onChange, title = "5. Freight", asCard = true, idPrefix = "gp-fr", description,
}: {
  value: FreightFormState;
  onChange: (next: FreightFormState) => void;
  title?: string;
  asCard?: boolean;
  idPrefix?: string;
  description?: string;
}) {
  const { data: transporters = [] } = useTransporters();
  const set = (patch: Partial<FreightFormState>) => onChange({ ...value, ...patch });
  const picked = transporters.find((t) => t.id === value.transporter_id);

  const pickTransporter = (id: string) => {
    const t = transporters.find((x) => x.id === id);
    set({
      transporter_id: id,
      mode: value.mode || (t?.default_mode ?? ""),
      amount: value.amount || (t?.default_rate ? String(t.default_rate) : ""),
    });
  };

  const fields = (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {PAYERS.map((p) => {
          const selected = value.payer === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => set({ payer: p.value })}
              className={cn(
                "text-left rounded-xl border p-3 transition-colors flex flex-col gap-1",
                selected ? "border-primary ring-2 ring-primary bg-primary/5" : "hover:bg-muted/50",
              )}
            >
              <span className="font-semibold text-sm">{p.label}</span>
              <span className="text-xs text-muted-foreground leading-snug">{p.description}</span>
            </button>
          );
        })}
      </div>

      {value.payer === "company" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <Label htmlFor={`${idPrefix}-mode`}>Mode *</Label>
            <Select value={value.mode || undefined} onValueChange={(v) => set({ mode: v as FreightMode })}>
              <SelectTrigger id={`${idPrefix}-mode`}><SelectValue placeholder="How does it go?" /></SelectTrigger>
              <SelectContent>
                {MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-transporter`}>Transporter *</Label>
            <Select value={value.transporter_id || undefined} onValueChange={pickTransporter}>
              <SelectTrigger id={`${idPrefix}-transporter`}><SelectValue placeholder="Contractor or app" /></SelectTrigger>
              <SelectContent>
                {transporters.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} · {kindLabel(t.kind)}{t.default_rate ? ` · ${fmtRs(t.default_rate)}` : ""}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_TRANSPORTER}>+ New transporter (type the name)</SelectItem>
              </SelectContent>
            </Select>
            {picked && (
              <p className="text-xs text-muted-foreground mt-1">
                {kindLabel(picked.kind)} · usually {modeLabel(picked.default_mode).toLowerCase()}{picked.phone ? ` · ${picked.phone}` : ""}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-amount`}>Amount (Rs) *</Label>
            <Input id={`${idPrefix}-amount`} type="number" min="1" step="1" inputMode="numeric" value={value.amount}
              onChange={(e) => set({ amount: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-ref`}>Ride / booking ref</Label>
            <Input id={`${idPrefix}-ref`} value={value.booking_ref} placeholder="App ride number"
              onChange={(e) => set({ booking_ref: e.target.value })} />
          </div>

          {value.transporter_id === NEW_TRANSPORTER && (
            <>
              <div className="sm:col-span-2">
                <Label htmlFor={`${idPrefix}-newname`}>New transporter name *</Label>
                <Input id={`${idPrefix}-newname`} value={value.new_name} placeholder="e.g. Shahid Transport, Bykea"
                  onChange={(e) => set({ new_name: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${idPrefix}-newkind`}>Kind</Label>
                <Select value={value.new_kind} onValueChange={(v) => set({ new_kind: v as TransporterKind })}>
                  <SelectTrigger id={`${idPrefix}-newkind`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={`${idPrefix}-newphone`}>Phone</Label>
                <Input id={`${idPrefix}-newphone`} value={value.new_phone} onChange={(e) => set({ new_phone: e.target.value })} />
              </div>
            </>
          )}

          <div className="sm:col-span-2 lg:col-span-4">
            <Label htmlFor={`${idPrefix}-note`}>Note</Label>
            <Input id={`${idPrefix}-note`} value={value.note} onChange={(e) => set({ note: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );

  if (!asCard) return fields;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Truck className="h-4 w-4" /> {title}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {description ?? "Who pays for the vehicle. When the company pays, a freight voucher is made the moment the guard lets the vehicle out, and the driver or contractor collects cash against it. The amount is never printed on the gate pass."}
        </p>
      </CardHeader>
      <CardContent>{fields}</CardContent>
    </Card>
  );
}
