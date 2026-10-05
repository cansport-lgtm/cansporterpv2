import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileClock, PackageCheck, Scale, XCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { errorMessage, fmtQty, gpDb, photoUrl, todayPk, type GatePass } from "@/lib/gatePass";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmtInAt, giDb, type InwardEntry } from "@/lib/gateInward";

// Detail-page sections for Phase 2/3 pass types.

type OpenLine = {
  gate_pass_item_id: string;
  line_no: number;
  description: string;
  uom: string;
  sent: number;
  expected_output_description: string | null;
  settled: number;
  output_received: number;
  rejected: number;
  wastage: number;
  balance: number;
  is_overdue: boolean;
};

type Receipt = {
  id: string;
  receipt_number: string;
  receipt_date: string;
  remarks: string | null;
  creator: { full_name: string | null } | null;
  gate_pass_receipt_items: {
    id: string;
    gate_pass_item_id: string;
    settled_quantity: number;
    output_description: string | null;
    output_uom: string | null;
    output_quantity: number;
    rejected_quantity: number;
  }[];
};

const invalidateAll = (qc: ReturnType<typeof useQueryClient>, id: string) => {
  ["gate-pass", "gate-pass-events", "gate-pass-open-lines", "gate-pass-receipts"].forEach((k) =>
    qc.invalidateQueries({ queryKey: [k, id] }));
  ["gate-passes", "gate-passes-live", "gate-pass-outside", "gate-pass-dashboard"].forEach((k) =>
    qc.invalidateQueries({ queryKey: [k] }));
};

/** Returnable / job work: what is still out, receipts, receive and close. */
export function ReturnsSection({ pass, canReceive, canClose }: { pass: GatePass; canReceive: boolean; canClose: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const jobWork = pass.pass_type === "job_work";
  const [receiving, setReceiving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [date, setDate] = useState(todayPk());
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [entry, setEntry] = useState<Record<string, { settled: string; output: string; rejected: string }>>({});
  const [inwardId, setInwardId] = useState<string>("");

  // Gate inward entries recorded for this pass and not yet received: the receipt names one.
  const { data: inwardEntries = [] } = useQuery<InwardEntry[]>({
    queryKey: ["gate-inward", "for-pass", pass.id],
    queryFn: async () => {
      const { data, error } = await giDb
        .from("v_gate_inward_register").select("*")
        .eq("gate_pass_id", pass.id).eq("status", "at_gate").order("in_at");
      if (error) return [];
      return data ?? [];
    },
  });

  const { data: lines = [] } = useQuery<OpenLine[]>({
    queryKey: ["gate-pass-open-lines", pass.id],
    queryFn: async () => {
      const { data, error } = await gpDb.from("v_gate_pass_open_lines").select("*").eq("gate_pass_id", pass.id).order("line_no");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: receipts = [] } = useQuery<Receipt[]>({
    queryKey: ["gate-pass-receipts", pass.id],
    queryFn: async () => {
      const { data, error } = await gpDb
        .from("gate_pass_receipts")
        .select("id, receipt_number, receipt_date, remarks, creator:app_users!gate_pass_receipts_created_by_fkey(full_name), gate_pass_receipt_items(*)")
        .eq("gate_pass_id", pass.id)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const open = ["out", "partially_returned"].includes(pass.status);
  const lineName = (id: string) => lines.find((l) => l.gate_pass_item_id === id)?.description ?? "";

  const receive = useMutation({
    mutationFn: async () => {
      const payload = lines.map((l) => ({
        gate_pass_item_id: l.gate_pass_item_id,
        settled_quantity: entry[l.gate_pass_item_id]?.settled || 0,
        output_quantity: entry[l.gate_pass_item_id]?.output || 0,
        rejected_quantity: entry[l.gate_pass_item_id]?.rejected || 0,
      }));
      const { data: receiptId, error } = await gpDb.rpc("gate_pass_receive", { p_id: pass.id, p_date: date, p_lines: payload, p_remarks: note });
      if (error) throw error;
      if (inwardId && receiptId) {
        const { error: linkErr } = await giDb.rpc("gate_inward_attach_receipt", { p_entry_id: inwardId, p_receipt_id: receiptId });
        if (linkErr) throw new Error(`Receipt saved, but the gate inward entry could not be linked: ${linkErr.message}`);
      }
    },
    onSuccess: () => {
      toast({ title: "Receipt saved" });
      setReceiving(false); setEntry({}); setNote(""); setInwardId("");
      invalidateAll(qc, pass.id);
      qc.invalidateQueries({ queryKey: ["gate-inward"] });
    },
    onError: (e) => toast({ title: "Could not save the receipt", description: errorMessage(e), variant: "destructive" }),
  });
  const close = useMutation({
    mutationFn: async () => {
      const { error } = await gpDb.rpc("gate_pass_close", { p_id: pass.id, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Pass closed" });
      setClosing(false); setReason("");
      invalidateAll(qc, pass.id);
    },
    onError: (e) => toast({ title: "Could not close", description: errorMessage(e), variant: "destructive" }),
  });

  const setField = (id: string, f: "settled" | "output" | "rejected", v: string) =>
    setEntry((e) => ({ ...e, [id]: { settled: "", output: "", rejected: "", ...e[id], [f]: v } }));
  const stillOut = lines.reduce((s, l) => s + Number(l.balance), 0);

  return (
    <>
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">
            {jobWork ? "Sent and received" : "Out and back"}
            {pass.expected_return_date && (
              <span className={cn("ml-2 text-sm font-normal", lines.some((l) => l.is_overdue) ? "text-red-700 font-semibold" : "text-muted-foreground")}>
                · due {format(new Date(pass.expected_return_date), "dd MMM yyyy")}{lines.some((l) => l.is_overdue) ? " (overdue)" : ""}
              </span>
            )}
          </CardTitle>
          <div className="flex gap-2">
            {open && canReceive && (
              <Button size="sm" onClick={() => {
                const latest = inwardEntries[inwardEntries.length - 1];
                setInwardId(latest?.id ?? "");
                setDate(latest?.entry_date ?? todayPk());
                setReceiving(true);
              }}>
                <PackageCheck className="h-4 w-4 mr-1" /> Receive goods
              </Button>
            )}
            {open && canClose && (
              <Button size="sm" variant="outline" onClick={() => setClosing(true)}>
                <XCircle className="h-4 w-4 mr-1" /> Close pass
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {inwardEntries.length > 0 && (
            <div className="m-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <b>Vehicle arrived at the gate, not yet received:</b>{" "}
              {inwardEntries.map((e) => `${e.entry_number} (${e.vehicle_number}, in ${fmtInAt(e.in_at)})`).join(" · ")}.
              {open && canReceive ? " Use Receive goods to record what came back." : ""}
            </div>
          )}
          {lines.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Shown once the vehicle has gone out.</p>
          ) : (
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Line</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">{jobWork ? "Used up" : "Back"}</TableHead>
                  {jobWork && <TableHead className="text-right">Processed received</TableHead>}
                  {jobWork && <TableHead className="text-right">Rejected</TableHead>}
                  <TableHead className="text-right">{jobWork ? "Wastage" : "Written off"}</TableHead>
                  <TableHead className="text-right">Still out</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.gate_pass_item_id}>
                    <TableCell>
                      <div className="font-medium">{l.description}</div>
                      {l.expected_output_description && <div className="text-xs text-muted-foreground">Comes back as {l.expected_output_description}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtQty(l.sent)} {l.uom}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtQty(l.settled)}</TableCell>
                    {jobWork && <TableCell className="text-right tabular-nums text-emerald-700 font-medium">{fmtQty(l.output_received)}</TableCell>}
                    {jobWork && <TableCell className="text-right tabular-nums text-red-700">{fmtQty(l.rejected)}</TableCell>}
                    <TableCell className="text-right tabular-nums">{fmtQty(l.wastage)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums font-semibold", Number(l.balance) > 0 && "text-violet-700")}>{fmtQty(l.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {receipts.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Receipts</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {receipts.map((r) => (
              <div key={r.id} className="rounded-lg border p-3 text-sm space-y-1">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-semibold font-mono">{r.receipt_number}</span>
                  <span className="text-muted-foreground">{format(new Date(r.receipt_date), "dd MMM yyyy")} · {r.creator?.full_name ?? ""}</span>
                </div>
                {r.gate_pass_receipt_items.map((ri) => (
                  <div key={ri.id} className="text-muted-foreground">
                    {lineName(ri.gate_pass_item_id)}: {jobWork ? "used" : "back"} {fmtQty(ri.settled_quantity)}
                    {jobWork && Number(ri.output_quantity) > 0 && <> · received {fmtQty(ri.output_quantity)} {ri.output_uom} {ri.output_description}</>}
                    {jobWork && Number(ri.rejected_quantity) > 0 && <span className="text-red-700"> · rejected {fmtQty(ri.rejected_quantity)}</span>}
                  </div>
                ))}
                {r.remarks && <div>{r.remarks}</div>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={receiving} onOpenChange={setReceiving}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Receive goods — {pass.pass_number}</DialogTitle>
            <DialogDescription>
              {jobWork
                ? "For each line: how much of the material sent was used up, how much processed goods came back good, and how many you rejected."
                : "Enter what came back on each line."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            {lines.filter((l) => Number(l.balance) > 0).map((l) => (
              <div key={l.gate_pass_item_id} className="rounded-lg border p-3 space-y-2">
                <div className="text-sm font-medium">{l.description} <span className="text-muted-foreground font-normal">— {fmtQty(l.balance)} {l.uom} still out</span></div>
                <div className={cn("grid gap-2", jobWork ? "grid-cols-3" : "grid-cols-1 max-w-[200px]")}>
                  <div>
                    <Label className="text-xs" htmlFor={`rs-${l.gate_pass_item_id}`}>{jobWork ? `Material used up (${l.uom})` : `Came back (${l.uom})`}</Label>
                    <Input id={`rs-${l.gate_pass_item_id}`} type="number" min="0" step="any" value={entry[l.gate_pass_item_id]?.settled ?? ""}
                      onChange={(e) => setField(l.gate_pass_item_id, "settled", e.target.value)} />
                  </div>
                  {jobWork && (
                    <>
                      <div>
                        <Label className="text-xs" htmlFor={`ro-${l.gate_pass_item_id}`}>Processed received good</Label>
                        <Input id={`ro-${l.gate_pass_item_id}`} type="number" min="0" step="any" value={entry[l.gate_pass_item_id]?.output ?? ""}
                          onChange={(e) => setField(l.gate_pass_item_id, "output", e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs" htmlFor={`rr-${l.gate_pass_item_id}`}>Rejected by us</Label>
                        <Input id={`rr-${l.gate_pass_item_id}`} type="number" min="0" step="any" value={entry[l.gate_pass_item_id]?.rejected ?? ""}
                          onChange={(e) => setField(l.gate_pass_item_id, "rejected", e.target.value)} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          {inwardEntries.length > 0 && (
            <div>
              <Label htmlFor="rc-inward">Came in on gate entry</Label>
              <Select value={inwardId || "none"} onValueChange={(v) => {
                setInwardId(v === "none" ? "" : v);
                const e = inwardEntries.find((x) => x.id === v);
                if (e) setDate(e.entry_date);
              }}>
                <SelectTrigger id="rc-inward"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not recorded at the gate</SelectItem>
                  {inwardEntries.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.entry_number} · {e.vehicle_number} · in {fmtInAt(e.in_at)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3">
            <div>
              <Label htmlFor="rc-date">Date received</Label>
              <Input id="rc-date" type="date" value={date} max={todayPk()} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="rc-note">Remarks</Label>
              <Input id="rc-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiving(false)}>Back</Button>
            <Button disabled={receive.isPending} onClick={() => receive.mutate()}>Save receipt</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close {pass.pass_number}</DialogTitle>
            <DialogDescription>
              {fmtQty(stillOut)} still out will be booked as {jobWork ? "vendor wastage" : "not returned (written off)"}. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="cl-reason">Reason *</Label>
            <Textarea id="cl-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(false)}>Back</Button>
            <Button variant="destructive" disabled={close.isPending} onClick={() => close.mutate()}>Close pass</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Weighment = { id: string; seq: number; scrap_category_id: string | null; reading: number; net: number | null; slip_number: string | null };

/** Scrap: approved weight vs weighed, rates and value (office only), the weighment and slip photo. */
export function ScrapSection({ pass }: { pass: GatePass }) {
  const { data: rates = [] } = useQuery<{ scrap_category_id: string; rate: number }[]>({
    queryKey: ["gate-pass-scrap-rates", pass.id],
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_scrap_rates").select("scrap_category_id, rate").eq("gate_pass_id", pass.id);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: weighs = [] } = useQuery<Weighment[]>({
    queryKey: ["gate-pass-weighments", pass.id],
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_weighments").select("*").eq("gate_pass_id", pass.id).order("seq");
      if (error) throw error;
      return data ?? [];
    },
  });
  const items = [...(pass.gate_pass_items ?? [])].sort((a, b) => a.line_no - b.line_no);
  const rateOf = (cat: string | null) => rates.find((r) => r.scrap_category_id === cat)?.rate;
  const weighed = weighs.length > 0;
  const total = items.reduce((s, i) => s + Number(i.quantity) * Number(rateOf(i.scrap_category_id) ?? 0), 0);
  const slip = photoUrl(pass.weighbridge_photo_path);

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2"><Scale className="h-4 w-4" /> Scrap weight and value</CardTitle>
        {slip && <a href={slip} target="_blank" rel="noreferrer" className="text-sm text-primary underline">Weighbridge slip photo</a>}
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Approved</TableHead>
              <TableHead className="text-right">{weighed ? "Weighed (net)" : "Weighed"}</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Value (Rs)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-medium">{i.description}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtQty(i.estimated_quantity ?? i.quantity)} {i.uom}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{weighed || pass.is_backfill ? `${fmtQty(i.quantity)} ${i.uom}` : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{rateOf(i.scrap_category_id) !== undefined ? fmtQty(rateOf(i.scrap_category_id)) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtQty(Number(i.quantity) * Number(rateOf(i.scrap_category_id) ?? 0))}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell colSpan={4}>Total{weighed || pass.is_backfill ? "" : " (at the approved weight)"}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtQty(total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        {weighed && (
          <div className="p-4 border-t text-sm space-y-1">
            <div className="font-medium">Weighment at the gate</div>
            {weighs.map((w) => (
              <div key={w.id} className="text-muted-foreground tabular-nums">
                {w.seq}. {w.scrap_category_id ? `After ${items.find((i) => i.scrap_category_id === w.scrap_category_id)?.description ?? "category"}` : "Empty truck"}:
                {" "}{fmtQty(w.reading)} kg{w.net !== null ? ` → net ${fmtQty(w.net)} kg` : ""}{w.slip_number ? ` · slip ${w.slip_number}` : ""}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** A manually backfilled paper pass. */
export function BackfillInfo({ pass }: { pass: GatePass }) {
  const photo = photoUrl(pass.paper_photo_path);
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3 text-sm">
      <FileClock className="h-5 w-5 text-amber-700 shrink-0" />
      <div className="space-y-1">
        <div className="font-semibold text-amber-900">
          Manual backfill of paper pass {pass.gate_pass_books?.book_number ?? ""} / {pass.book_serial}
          {pass.paper_datetime ? ` — written ${format(new Date(pass.paper_datetime), "dd MMM yyyy, HH:mm")}` : ""}
        </div>
        {pass.backfill_reason && <div className="text-amber-900">{pass.backfill_reason}</div>}
        {photo && <a href={photo} target="_blank" rel="noreferrer" className="text-primary underline">Photo of the paper pass</a>}
      </div>
    </div>
  );
}
