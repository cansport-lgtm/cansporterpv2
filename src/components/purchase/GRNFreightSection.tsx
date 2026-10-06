import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { gpDb } from "@/lib/gatePass";
import {
  ALL_MODES, GRN_PAYERS, KINDS, fmtRs, kindLabel, modeLabel,
  type FreightMode, type GrnFreight, type GrnFreightLogRow, type GrnFreightPayer, type TransporterKind,
} from "@/lib/gatePassFreight";
import { NEW_TRANSPORTER, useTransporters } from "@/components/gate-pass/FreightSection";

export type GrnFreightFormState = {
  payer: GrnFreightPayer | "";
  mode: FreightMode | "";
  transporter_id: string;      // "" = none picked
  new_name: string;            // typed when transporter_id === NEW_TRANSPORTER
  new_kind: TransporterKind;
  new_phone: string;
  amount: string;              // paid to the transporter, or on the supplier's bill
  booking_ref: string;
  driver_name: string;
  driver_contact: string;
  vehicle_number: string;
  shared_grn_id: string;
  note: string;
};

export const emptyGrnFreight = (): GrnFreightFormState => ({
  payer: "", mode: "", transporter_id: "", new_name: "", new_kind: "contractor", new_phone: "",
  amount: "", booking_ref: "", driver_name: "", driver_contact: "", vehicle_number: "", shared_grn_id: "", note: "",
});

export const grnFreightFromRow = (f: GrnFreight | null | undefined, transportationCost?: number | null): GrnFreightFormState =>
  f
    ? {
        payer: f.payer, mode: f.mode ?? "", transporter_id: f.transporter_id ?? "",
        new_name: f.transporter_id ? "" : f.transporter_name ?? "", new_kind: "contractor", new_phone: "",
        amount: f.amount === null || f.amount === undefined ? "" : String(f.amount),
        booking_ref: f.booking_ref ?? "", driver_name: f.driver_name ?? "", driver_contact: f.driver_contact ?? "",
        vehicle_number: f.vehicle_number ?? "", shared_grn_id: f.shared_grn_id ?? "", note: f.note ?? "",
      }
    : {
        // An old GRN: a transportation cost typed before this was built was on the supplier's bill.
        ...emptyGrnFreight(),
        ...(Number(transportationCost || 0) > 0 ? { payer: "supplier_billed" as const, amount: String(transportationCost) } : {}),
      };

export const isCompanyPaid = (p: string) => p === "company" || p === "company_recover";

/** Freight on the supplier's bill, which is added to the GRN total. */
export const supplierBilledAmount = (s: GrnFreightFormState) =>
  s.payer === "supplier_billed" ? parseFloat(s.amount) || 0 : 0;

/** What grn_freight_save expects. */
export const grnFreightPayload = (s: GrnFreightFormState, extra: Record<string, unknown> = {}) => {
  const paying = isCompanyPaid(s.payer);
  return {
    payer: s.payer,
    mode: paying ? s.mode : null,
    transporter_id: paying && s.transporter_id && s.transporter_id !== NEW_TRANSPORTER ? s.transporter_id : null,
    transporter_name: paying && s.transporter_id === NEW_TRANSPORTER ? s.new_name : null,
    transporter_kind: s.transporter_id === NEW_TRANSPORTER ? s.new_kind : null,
    transporter_phone: s.transporter_id === NEW_TRANSPORTER ? s.new_phone : null,
    amount: paying || s.payer === "supplier_billed" ? s.amount : null,
    booking_ref: s.booking_ref,
    driver_name: s.driver_name,
    driver_contact: s.driver_contact,
    vehicle_number: s.vehicle_number,
    shared_grn_id: s.payer === "other_grn" ? s.shared_grn_id : null,
    note: s.note,
    ...extra,
  };
};

/** Checked before the GRN is saved, so a bad freight never leaves a GRN without it. */
export function grnFreightError(s: GrnFreightFormState): string | null {
  if (!s.payer) return "Freight: say who paid for the vehicle";
  if (s.payer === "supplier_billed" && !(parseFloat(s.amount) > 0)) return "Freight: enter the freight on the supplier's bill";
  if (isCompanyPaid(s.payer)) {
    if (!s.mode) return "Freight: choose how the goods came";
    if (!s.transporter_id) return "Freight: choose the transporter";
    if (s.transporter_id === NEW_TRANSPORTER && !s.new_name.trim()) return "Freight: type the new transporter's name";
    if (!(parseFloat(s.amount) > 0)) return "Freight: enter the amount paid to the transporter";
  }
  if (s.payer === "other_grn" && !s.shared_grn_id) return "Freight: choose the GRN the trip was recorded on";
  return null;
}

/**
 * The Freight section of a GRN: who paid for the vehicle that brought the
 * goods. Company-paid freight makes a voucher (FV-…) when the GRN is saved and
 * never enters the supplier's payable; supplier-billed freight is added to the
 * GRN total.
 */
export function GRNFreightSection({
  value, onChange, currentGrnId, idPrefix = "grn-fr",
}: {
  value: GrnFreightFormState;
  onChange: (next: GrnFreightFormState) => void;
  currentGrnId?: string;
  idPrefix?: string;
}) {
  const { data: transporters = [] } = useTransporters();
  const set = (patch: Partial<GrnFreightFormState>) => onChange({ ...value, ...patch });
  const picked = transporters.find((t) => t.id === value.transporter_id);
  const paying = isCompanyPaid(value.payer);

  // GRNs of the last two weeks whose freight the company paid — for "On another GRN".
  const { data: shareable = [] } = useQuery<GrnFreightLogRow[]>({
    queryKey: ["grn-freight-shareable"],
    enabled: value.payer === "other_grn",
    queryFn: async () => {
      const { data, error } = await gpDb.from("v_grn_freight_log").select("*")
        .in("payer", ["company", "company_recover"])
        .gte("receipt_date", format(subDays(new Date(), 14), "yyyy-MM-dd"))
        .order("receipt_date", { ascending: false });
      if (error) return [];
      return data ?? [];
    },
  });

  const pickTransporter = (id: string) => {
    const t = transporters.find((x) => x.id === id);
    set({
      transporter_id: id,
      mode: value.mode || (t?.default_mode ?? ""),
      amount: value.amount || (t?.default_rate ? String(t.default_rate) : ""),
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {GRN_PAYERS.map((p) => {
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

      {value.payer === "supplier_billed" && (
        <div className="max-w-xs">
          <Label htmlFor={`${idPrefix}-billed`}>Freight on the supplier's bill (Rs) *</Label>
          <Input id={`${idPrefix}-billed`} type="number" min="1" step="0.01" value={value.amount}
            onChange={(e) => set({ amount: e.target.value })} />
        </div>
      )}

      {value.payer === "other_grn" && (
        <div className="max-w-md">
          <Label htmlFor={`${idPrefix}-shared`}>Freight recorded on GRN *</Label>
          <Select value={value.shared_grn_id || undefined} onValueChange={(v) => set({ shared_grn_id: v })}>
            <SelectTrigger id={`${idPrefix}-shared`}><SelectValue placeholder="The GRN of the same vehicle" /></SelectTrigger>
            <SelectContent>
              {shareable.filter((r) => r.grn_id !== currentGrnId).map((r) => (
                <SelectItem key={r.grn_id} value={r.grn_id}>
                  {r.grn_number} · {r.supplier_name ?? ""} · {r.vehicle_number ?? "—"} · {r.voucher_number ?? ""} {fmtRs(r.amount)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {shareable.length === 0 && (
            <p className="text-xs text-muted-foreground mt-1">No company-paid freight on a GRN in the last 14 days.</p>
          )}
        </div>
      )}

      {paying && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <Label htmlFor={`${idPrefix}-mode`}>Mode *</Label>
            <Select value={value.mode || undefined} onValueChange={(v) => set({ mode: v as FreightMode })}>
              <SelectTrigger id={`${idPrefix}-mode`}><SelectValue placeholder="How did it come?" /></SelectTrigger>
              <SelectContent>
                {ALL_MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-transporter`}>Transporter *</Label>
            <Select value={value.transporter_id || undefined} onValueChange={pickTransporter}>
              <SelectTrigger id={`${idPrefix}-transporter`}><SelectValue placeholder="Contractor, app or goods company" /></SelectTrigger>
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
            <Label htmlFor={`${idPrefix}-amount`}>Amount paid (Rs) *</Label>
            <Input id={`${idPrefix}-amount`} type="number" min="1" step="1" inputMode="numeric" value={value.amount}
              onChange={(e) => set({ amount: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-ref`}>Ride / bilty no.</Label>
            <Input id={`${idPrefix}-ref`} value={value.booking_ref} placeholder="App ride or bilty number"
              onChange={(e) => set({ booking_ref: e.target.value })} />
          </div>

          {value.transporter_id === NEW_TRANSPORTER && (
            <>
              <div className="sm:col-span-2">
                <Label htmlFor={`${idPrefix}-newname`}>New transporter name *</Label>
                <Input id={`${idPrefix}-newname`} value={value.new_name} placeholder="e.g. Shahid Transport, Daewoo Cargo"
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

          <div>
            <Label htmlFor={`${idPrefix}-vehicle`}>Vehicle no.</Label>
            <Input id={`${idPrefix}-vehicle`} value={value.vehicle_number} placeholder="From the gate inward entry"
              onChange={(e) => set({ vehicle_number: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-driver`}>Driver name</Label>
            <Input id={`${idPrefix}-driver`} value={value.driver_name} onChange={(e) => set({ driver_name: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-driverphone`}>Driver phone</Label>
            <Input id={`${idPrefix}-driverphone`} value={value.driver_contact} onChange={(e) => set({ driver_contact: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-note`}>Note</Label>
            <Input id={`${idPrefix}-note`} value={value.note} onChange={(e) => set({ note: e.target.value })} />
          </div>
          {value.payer === "company_recover" && (
            <p className="sm:col-span-2 lg:col-span-4 text-xs text-amber-700">
              The supplier's payable on this GRN is reduced by this amount when the GRN posts to the ledger.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
