import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { PackageCheck } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { fmtQty, gpDb, passTypeMeta, statusMeta } from "@/lib/gatePass";
import { giDb } from "@/lib/gateInward";

// Returnable and job-work goods outside the factory, and job-work reconciliation.

type Row = {
  gate_pass_id: string;
  pass_number: string;
  pass_type: "returnable" | "job_work";
  status: string;
  party_name: string;
  process_name: string | null;
  expected_return_date: string | null;
  gate_out_at: string | null;
  is_overdue: boolean;
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
};

export default function GatePassReturnsPage() {
  const [tab, setTab] = useState("outside");
  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["gate-pass-outside"],
    queryFn: async () => {
      const { data, error } = await gpDb
        .from("v_gate_pass_open_lines")
        .select("*")
        .order("expected_return_date", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Passes with a vehicle recorded at the gate and not yet received (Gate Inward).
  const { data: atGate = [] } = useQuery<{ gate_pass_id: string; entry_number: string; vehicle_number: string }[]>({
    queryKey: ["gate-inward", "at-gate-passes"],
    queryFn: async () => {
      const { data, error } = await giDb.from("gate_inward_entries").select("gate_pass_id, entry_number, vehicle_number")
        .eq("status", "at_gate").not("gate_pass_id", "is", null);
      if (error) return [];
      return data ?? [];
    },
  });
  const atGateByPass = useMemo(() => {
    const m = new Map<string, string[]>();
    atGate.forEach((e) => m.set(e.gate_pass_id, [...(m.get(e.gate_pass_id) ?? []), `${e.entry_number} (${e.vehicle_number})`]));
    return m;
  }, [atGate]);

  const outside = rows.filter((r) => Number(r.balance) > 0 && ["out", "partially_returned"].includes(r.status));
  const byPass = useMemo(() => {
    const m = new Map<string, Row[]>();
    outside.forEach((r) => m.set(r.gate_pass_id, [...(m.get(r.gate_pass_id) ?? []), r]));
    return [...m.values()].sort((a, b) =>
      Number(b[0].is_overdue) - Number(a[0].is_overdue) ||
      (a[0].expected_return_date ?? "").localeCompare(b[0].expected_return_date ?? ""));
  }, [outside]);
  const overdue = byPass.filter((ls) => ls[0].is_overdue).length;

  // Job-work reconciliation per vendor.
  const vendors = useMemo(() => {
    const m = new Map<string, { vendor: string; passes: Set<string>; sent: number; used: number; received: number; rejected: number; wastage: number; balance: number }>();
    rows.filter((r) => r.pass_type === "job_work").forEach((r) => {
      const v = m.get(r.party_name) ?? { vendor: r.party_name, passes: new Set<string>(), sent: 0, used: 0, received: 0, rejected: 0, wastage: 0, balance: 0 };
      v.passes.add(r.gate_pass_id);
      v.sent += Number(r.sent); v.used += Number(r.settled); v.received += Number(r.output_received);
      v.rejected += Number(r.rejected); v.wastage += Number(r.wastage); v.balance += Number(r.balance);
      m.set(r.party_name, v);
    });
    return [...m.values()].sort((a, b) => b.balance - a.balance);
  }, [rows]);
  const jobLines = rows.filter((r) => r.pass_type === "job_work");

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Returns & Job Work" description="Goods outside the factory on returnable and job-work passes. Open a pass to receive goods back." icon={PackageCheck} />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Passes with goods outside", value: byPass.length, tone: "" },
            { label: "Overdue", value: overdue, tone: overdue ? "text-red-700" : "" },
            { label: "Out for repair (passes)", value: byPass.filter((l) => l[0].pass_type === "returnable").length, tone: "text-sky-700" },
            { label: "At job work (passes)", value: byPass.filter((l) => l[0].pass_type === "job_work").length, tone: "text-violet-700" },
          ].map((k) => (
            <Card key={k.label}><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className={cn("text-2xl font-display font-bold mt-1", k.tone)}>{k.value}</div>
            </CardContent></Card>
          ))}
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="outside">Outside now</TabsTrigger>
            <TabsTrigger value="jobwork">Job work reconciliation</TabsTrigger>
          </TabsList>

          <TabsContent value="outside" className="space-y-3">
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!isLoading && byPass.length === 0 && <p className="text-sm text-muted-foreground">Nothing is outside right now.</p>}
            {byPass.map((ls) => {
              const h = ls[0];
              return (
                <Card key={h.gate_pass_id} className={cn(h.is_overdue && "border-red-300")}>
                  <CardHeader className="pb-2 flex flex-row flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base flex flex-wrap items-center gap-2">
                      <Link to={`/gate-pass/passes/${h.gate_pass_id}`} className="text-primary hover:underline font-mono">{h.pass_number}</Link>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", passTypeMeta(h.pass_type).badgeClass)}>
                        {passTypeMeta(h.pass_type).label}{h.process_name ? ` · ${h.process_name}` : ""}
                      </span>
                      <span className="text-sm font-normal">{h.party_name}</span>
                    </CardTitle>
                    <div className="flex items-center gap-2 text-sm">
                      {atGateByPass.has(h.gate_pass_id) && (
                        <Badge variant="warning" title={atGateByPass.get(h.gate_pass_id)!.join(", ")}>At gate — receive</Badge>
                      )}
                      <Badge variant={statusMeta(h.status).variant}>{statusMeta(h.status).label}</Badge>
                      {h.expected_return_date && (
                        <span className={cn(h.is_overdue ? "text-red-700 font-semibold" : "text-muted-foreground")}>
                          Due {format(new Date(h.expected_return_date), "dd MMM yyyy")}{h.is_overdue ? " — overdue" : ""}
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Line</TableHead>
                          <TableHead className="text-right">Sent</TableHead>
                          <TableHead className="text-right">Back / used</TableHead>
                          <TableHead className="text-right">Still out</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ls.map((r) => (
                          <TableRow key={r.gate_pass_item_id}>
                            <TableCell>{r.description}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtQty(r.sent)} {r.uom}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtQty(r.settled)}</TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">{fmtQty(r.balance)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="jobwork" className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">By vendor</CardTitle></CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead className="text-right">Passes</TableHead>
                      <TableHead className="text-right">Sent</TableHead>
                      <TableHead className="text-right">Used up</TableHead>
                      <TableHead className="text-right">Processed received</TableHead>
                      <TableHead className="text-right">Rejected</TableHead>
                      <TableHead className="text-right">Wastage</TableHead>
                      <TableHead className="text-right">Still with vendor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendors.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">No job work yet.</TableCell></TableRow>
                    ) : vendors.map((v) => (
                      <TableRow key={v.vendor}>
                        <TableCell className="font-medium">{v.vendor}</TableCell>
                        <TableCell className="text-right">{v.passes.size}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtQty(v.sent)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtQty(v.used)}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-700">{fmtQty(v.received)}</TableCell>
                        <TableCell className="text-right tabular-nums text-red-700">{fmtQty(v.rejected)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtQty(v.wastage)}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-violet-700">{fmtQty(v.balance)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground p-3">Totals add up lines in their own units; open a vendor's passes below for exact units.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Every job-work line</CardTitle></CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[900px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pass</TableHead>
                      <TableHead>Vendor · process</TableHead>
                      <TableHead>Sent → comes back as</TableHead>
                      <TableHead className="text-right">Sent</TableHead>
                      <TableHead className="text-right">Used</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Rejected</TableHead>
                      <TableHead className="text-right">Wastage</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobLines.map((r) => (
                      <TableRow key={r.gate_pass_item_id}>
                        <TableCell><Link to={`/gate-pass/passes/${r.gate_pass_id}`} className="text-primary hover:underline font-mono text-sm">{r.pass_number}</Link></TableCell>
                        <TableCell className="text-sm">{r.party_name}{r.process_name ? ` · ${r.process_name}` : ""}</TableCell>
                        <TableCell className="text-sm">{r.description} → {r.expected_output_description ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtQty(r.sent)} {r.uom}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtQty(r.settled)}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-700">{fmtQty(r.output_received)}</TableCell>
                        <TableCell className="text-right tabular-nums text-red-700">{fmtQty(r.rejected)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtQty(r.wastage)}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{fmtQty(r.balance)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ERPLayout>
  );
}
