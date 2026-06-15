import { useState, useMemo, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PackageCheck } from "lucide-react";
import { format } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";

export default function MaterialReceivedSection() {
  const today = format(new Date(), "yyyy-MM-dd");
  const isMobile = useIsMobile();
  const [departmentId, setDepartmentId] = useState<string>("");
  const [date, setDate] = useState(today);

  const { data: eligibleDepts = [] } = useQuery({
    queryKey: ["mr-section-eligible-depts"],
    queryFn: async () => {
      const [{ data: eligible }, { data: storeDepts }] = await Promise.all([
        supabase.from("job_order_eligible_departments").select("department_id"),
        supabase.from("production_departments").select("id, name").eq("is_active", true).ilike("name", "%store%"),
      ]);
      const ids = (eligible || []).map((r: any) => r.department_id);
      let eligibleRows: any[] = [];
      if (ids.length > 0) {
        const { data } = await supabase.from("production_departments").select("id, name").in("id", ids).eq("is_active", true);
        eligibleRows = data || [];
      }
      const merged = [...eligibleRows, ...(storeDepts || [])];
      const dedup = Array.from(new Map(merged.map((d: any) => [d.id, d])).values());
      dedup.sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
      return dedup;
    },
  });

  const { data: materials = [] } = useQuery({
    queryKey: ["mr-section-materials"],
    queryFn: async () => (await supabase.from("hp_materials").select("id, code, name, unit")).data || [],
  });

  const { data: users = [] } = useQuery({
    queryKey: ["mr-section-users"],
    queryFn: async () => (await supabase.from("app_users").select("id, full_name")).data || [],
  });

  const materialMap = useMemo(() => Object.fromEntries(materials.map((m: any) => [m.id, m])), [materials]);
  const userMap = useMemo(() => Object.fromEntries(users.map((u: any) => [u.id, u.full_name])), [users]);

  const { data: issuances = [] } = useQuery({
    queryKey: ["mr-section-issuances", departmentId, date],
    queryFn: async () => {
      if (!departmentId) return [];
      const { data } = await supabase
        .from("hp_material_issuance").select("*")
        .eq("department_id", departmentId).eq("issue_date", date);
      return data || [];
    },
    enabled: !!departmentId,
  });

  const issuanceIds = issuances.map((i: any) => i.id);
  const { data: items = [] } = useQuery({
    queryKey: ["mr-section-items", issuanceIds.join(",")],
    queryFn: async () => {
      if (issuanceIds.length === 0) return [];
      const { data } = await supabase.from("hp_material_issuance_items").select("*").in("issuance_id", issuanceIds);
      return data || [];
    },
    enabled: issuanceIds.length > 0,
  });

  const headerMap = useMemo(() => Object.fromEntries(issuances.map((i: any) => [i.id, i])), [issuances]);

  const rows = useMemo(() => items.map((it: any) => {
    const h = headerMap[it.issuance_id];
    const m = materialMap[it.material_id];
    return {
      ...it,
      issue_date: h?.issue_date,
      material_code: m?.code || "-",
      material_name: m?.name || "Unknown",
      unit: m?.unit || "",
      receiver_name: userMap[it.receiver_user_id] || "—",
    };
  }).sort((a, b) => String(a.material_name).toLowerCase().localeCompare(String(b.material_name).toLowerCase())), [items, headerMap, materialMap, userMap]);

  const groups = useMemo(() => {
    const map = new Map<string, { letter: string; rows: any[]; totalIssued: number; totalConsumed: number }>();
    for (const r of rows) {
      const ch = String(r.material_name || "#").trim().charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(ch) ? ch : "#";
      if (!map.has(letter)) map.set(letter, { letter, rows: [], totalIssued: 0, totalConsumed: 0 });
      const g = map.get(letter)!;
      g.rows.push(r);
      g.totalIssued += Number(r.issued_qty || 0);
      g.totalConsumed += Number(r.consumed_qty || 0);
    }
    return Array.from(map.values()).sort((a, b) => a.letter.localeCompare(b.letter));
  }, [rows]);

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending: "bg-amber-500/15 text-amber-600",
      accepted: "bg-green-500/15 text-green-600",
      rejected: "bg-red-500/15 text-red-600",
      closed: "bg-slate-500/15 text-slate-600",
    };
    return <Badge variant="secondary" className={map[status] || "bg-muted"}>{status}</Badge>;
  };

  return (
    <Card>
      <CardHeader className="pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <PackageCheck className="h-5 w-5 text-amber-600 shrink-0" />
          <span className="leading-tight">Material Received</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-3 sm:px-6 pb-3 sm:pb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
          <div>
            <Label className="text-xs">Department</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>
                {eligibleDepts.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
          </div>
        </div>

        {isMobile ? (
          <div className="space-y-2">
            {!departmentId ? (
              <div className="text-center text-muted-foreground text-sm py-6">Select a department to view records</div>
            ) : rows.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-6">No materials received on this date</div>
            ) : groups.map((g) => (
              <div key={g.letter} className="space-y-2">
                <div className="bg-amber-500/10 text-amber-700 px-2 py-1 rounded text-xs font-bold">{g.letter}</div>
                {g.rows.map((r) => (
                  <div key={r.id} className="rounded border p-2 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{r.material_name}</div>
                        <div className="text-[11px] font-mono text-muted-foreground">{r.material_code}</div>
                      </div>
                      {statusBadge(r.status)}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><div className="text-muted-foreground">Issued</div><div className="font-mono font-semibold">{Number(r.issued_qty || 0).toLocaleString()} {r.unit}</div></div>
                      <div className="text-right"><div className="text-muted-foreground">Consumed</div><div className="font-mono">{r.consumed_qty != null ? Number(r.consumed_qty).toLocaleString() : "-"}</div></div>
                      <div><div className="text-muted-foreground">Received By</div><div className="truncate">{r.receiver_name}</div></div>
                    </div>
                  </div>
                ))}
                <div className="rounded bg-amber-50/40 dark:bg-amber-900/10 border border-amber-200 px-2 py-1 flex items-center justify-between text-xs font-semibold">
                  <span>Subtotal — {g.letter} ({g.rows.length})</span>
                  <span className="font-mono">Issued: {g.totalIssued.toLocaleString()} · Consumed: {g.totalConsumed.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border overflow-x-auto">
            <Table className="text-xs sm:text-sm">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Date</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Issued Qty</TableHead>
                  <TableHead>Received By</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Consumed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!departmentId ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Select a department to view records</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No materials received on this date</TableCell></TableRow>
                ) : groups.map((g) => (
                  <Fragment key={g.letter}>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={7} className="font-bold text-xs py-1.5 text-amber-700">{g.letter}</TableCell>
                    </TableRow>
                    {g.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap">{r.issue_date ? format(new Date(r.issue_date), "dd MMM yyyy") : "-"}</TableCell>
                        <TableCell>
                          <div className="font-medium">{r.material_name}</div>
                          <div className="text-xs font-mono text-muted-foreground">{r.material_code}</div>
                        </TableCell>
                        <TableCell>{r.unit}</TableCell>
                        <TableCell className="text-right font-mono">{Number(r.issued_qty || 0).toLocaleString()}</TableCell>
                        <TableCell>{r.receiver_name}</TableCell>
                        <TableCell>{statusBadge(r.status)}</TableCell>
                        <TableCell className="text-right font-mono">{r.consumed_qty != null ? Number(r.consumed_qty).toLocaleString() : "-"}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-amber-50/40 dark:bg-amber-900/10 hover:bg-amber-50/40 font-semibold">
                      <TableCell colSpan={3} className="text-xs">Subtotal — {g.letter} ({g.rows.length})</TableCell>
                      <TableCell className="text-right font-mono">{g.totalIssued.toLocaleString()}</TableCell>
                      <TableCell colSpan={2}>—</TableCell>
                      <TableCell className="text-right font-mono">{g.totalConsumed.toLocaleString()}</TableCell>
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
