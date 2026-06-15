import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCard } from "@/components/shared/MetricCard";
import { Warehouse, PackageCheck, Boxes, ListChecks, Clock, Package, ChevronDown, ChevronRight } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";

const fmtNum = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
const fmtCurrency = (n: number) => "₹" + fmtNum(n);

/* ---------------- Material Received Section ---------------- */
function MaterialReceivedSection() {
  const today = format(new Date(), "yyyy-MM-dd");
  const isMobile = useIsMobile();

  const [departmentId, setDepartmentId] = useState<string>("");
  const [date, setDate] = useState(today);

  const { data: eligibleDepts = [] } = useQuery({
    queryKey: ["sm-recv-eligible-depts"],
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
    queryKey: ["sm-recv-materials"],
    queryFn: async () => {
      const { data } = await supabase.from("hp_materials").select("id, code, name, unit");
      return data || [];
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ["sm-recv-users"],
    queryFn: async () => {
      const { data } = await supabase.from("app_users").select("id, full_name");
      return data || [];
    },
  });

  const materialMap = useMemo(() => Object.fromEntries(materials.map((m: any) => [m.id, m])), [materials]);
  const userMap = useMemo(() => Object.fromEntries(users.map((u: any) => [u.id, u.full_name])), [users]);
  const deptMap = useMemo(() => Object.fromEntries(eligibleDepts.map((d: any) => [d.id, d.name])), [eligibleDepts]);

  const { data: issuances = [], isLoading: loadingHeaders } = useQuery({
    queryKey: ["sm-recv-issuances", departmentId, date],
    queryFn: async () => {
      if (!departmentId) return [];
      const { data } = await supabase
        .from("hp_material_issuance")
        .select("*")
        .eq("department_id", departmentId)
        .eq("issue_date", date)
        .order("issue_date", { ascending: false });
      return data || [];
    },
    enabled: !!departmentId,
  });

  const issuanceIds = issuances.map((i: any) => i.id);
  const { data: items = [], isLoading: loadingItems } = useQuery({
    queryKey: ["sm-recv-items", issuanceIds.join(",")],
    queryFn: async () => {
      if (issuanceIds.length === 0) return [];
      const { data } = await supabase.from("hp_material_issuance_items").select("*").in("issuance_id", issuanceIds);
      return data || [];
    },
    enabled: issuanceIds.length > 0,
  });

  const headerMap = useMemo(() => Object.fromEntries(issuances.map((i: any) => [i.id, i])), [issuances]);

  const rows = useMemo(() => {
    return items
      .map((it: any) => {
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
      })
      .sort((a, b) => {
        const an = String(a.material_name || "").toLowerCase();
        const bn = String(b.material_name || "").toLowerCase();
        if (an !== bn) return an < bn ? -1 : 1;
        return a.issue_date < b.issue_date ? 1 : -1;
      });
  }, [items, headerMap, materialMap, userMap]);

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

  const totals = useMemo(() => {
    const totalQty = rows.reduce((s, r) => s + Number(r.issued_qty || 0), 0);
    const pending = rows.filter((r) => r.status === "pending").length;
    return { issuances: issuances.length, items: rows.length, qty: totalQty, pending };
  }, [rows, issuances]);

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending: "bg-amber-500/15 text-amber-600",
      accepted: "bg-green-500/15 text-green-600",
      rejected: "bg-red-500/15 text-red-600",
      closed: "bg-slate-500/15 text-slate-600",
    };
    return <Badge variant="secondary" className={map[status] || "bg-muted"}>{status}</Badge>;
  };

  const loading = loadingHeaders || loadingItems;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <PackageCheck className="h-4 w-4 text-amber-600" />
          Material Received
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3">
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
          <div className="hidden md:flex items-end">
            <div className="text-sm text-muted-foreground">
              {departmentId ? `Showing: ${deptMap[departmentId] || ""}` : "Select a department to view received materials"}
            </div>
          </div>
        </div>

        {departmentId && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
            <MetricCard title="Issuances" value={totals.issuances} icon={ListChecks} />
            <MetricCard title="Line Items" value={totals.items} icon={Boxes} />
            <MetricCard title="Total Qty" value={totals.qty.toLocaleString()} icon={Package} />
            <MetricCard title="Pending Acceptance" value={totals.pending} icon={Clock} />
          </div>
        )}

        {isMobile ? (
          <div className="space-y-2">
            {!departmentId ? (
              <Card><CardContent className="p-6 text-center text-muted-foreground text-sm">Select a department to view records</CardContent></Card>
            ) : loading ? (
              <Card><CardContent className="p-6 text-center text-sm">Loading...</CardContent></Card>
            ) : rows.length === 0 ? (
              <Card><CardContent className="p-6 text-center text-muted-foreground text-sm">No materials received on this date</CardContent></Card>
            ) : groups.map((g) => (
              <div key={g.letter} className="space-y-2">
                <div className="sticky top-0 z-10 bg-amber-500/10 text-amber-700 px-2 py-1 rounded text-xs font-bold">
                  {g.letter}
                </div>
                {g.rows.map((r) => (
                  <Card key={r.id}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{r.material_name}</div>
                          <div className="text-[11px] font-mono text-muted-foreground">{r.material_code}</div>
                        </div>
                        {statusBadge(r.status)}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <div className="text-muted-foreground">Date</div>
                          <div>{r.issue_date ? format(new Date(r.issue_date), "dd MMM yyyy") : "-"}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-muted-foreground">Issued Qty</div>
                          <div className="font-mono font-semibold">{Number(r.issued_qty || 0).toLocaleString()} {r.unit}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Received By</div>
                          <div className="truncate">{r.receiver_name}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-muted-foreground">Consumed</div>
                          <div className="font-mono">{r.consumed_qty != null ? Number(r.consumed_qty).toLocaleString() : "-"}</div>
                        </div>
                      </div>
                      {r.remarks && (
                        <div className="text-xs">
                          <div className="text-muted-foreground">Remarks</div>
                          <div className="text-muted-foreground">{r.remarks}</div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
                <Card className="bg-amber-50/40 dark:bg-amber-900/10 border-amber-200">
                  <CardContent className="p-2 flex items-center justify-between text-xs font-semibold">
                    <span>Subtotal — {g.letter} ({g.rows.length})</span>
                    <span className="font-mono">Issued: {g.totalIssued.toLocaleString()} · Consumed: {g.totalConsumed.toLocaleString()}</span>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Issued Qty</TableHead>
                  <TableHead>Received By</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Consumed</TableHead>
                  <TableHead>Remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!departmentId ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10">Select a department to view records</TableCell></TableRow>
                ) : loading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-6">Loading...</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10">No materials received on this date</TableCell></TableRow>
                ) : groups.map((g) => (
                  <Fragment key={g.letter}>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={8} className="font-bold text-xs py-1.5 text-amber-700">{g.letter}</TableCell>
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
                        <TableCell className="text-xs text-muted-foreground">{r.remarks || "-"}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-amber-50/40 dark:bg-amber-900/10 hover:bg-amber-50/40 font-semibold">
                      <TableCell colSpan={3} className="text-xs">Subtotal — {g.letter} ({g.rows.length})</TableCell>
                      <TableCell className="text-right font-mono">{g.totalIssued.toLocaleString()}</TableCell>
                      <TableCell colSpan={2}>—</TableCell>
                      <TableCell className="text-right font-mono">{g.totalConsumed.toLocaleString()}</TableCell>
                      <TableCell>—</TableCell>
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

/* ---------------- Department Summary Section ---------------- */
function DepartmentSummarySection() {
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const isMobile = useIsMobile();
  const today = format(new Date(), "yyyy-MM-dd");
  const [date, setDate] = useState(today);
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());

  const toggleDept = (name: string) => {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const { data: closingData, isLoading } = useQuery({
    queryKey: ["sm-dept-closing", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_stock_closing")
        .select(`*, planning_items(id, code, name, unit, costing_value), production_departments(id, name)`)
        .eq("closing_date", date)
        .order("created_at");
      if (error) throw error;
      return data || [];
    },
  });

  const departmentBreakdown = useMemo(() => {
    if (!closingData) return [] as Array<any>;
    const map: Record<string, any> = {};
    closingData.forEach((row: any) => {
      const deptName = row.production_departments?.name || "Unassigned";
      const qty = Number(row.closing_quantity) || 0;
      const enteredQty = row.entered_quantity != null ? Number(row.entered_quantity) : qty;
      const multiplier = row.multiplier != null ? Number(row.multiplier) : 1;
      const cv = Number(row.planning_items?.costing_value) || 0;
      if (!map[deptName]) map[deptName] = { name: deptName, qty: 0, enteredQty: 0, value: 0, items: 0, rows: [] };
      map[deptName].qty += qty;
      map[deptName].enteredQty += enteredQty;
      map[deptName].value += qty * cv;
      map[deptName].items += 1;
      map[deptName].rows.push({
        code: row.planning_items?.code || "—",
        name: row.planning_items?.name || "—",
        unit: row.planning_items?.unit || "",
        enteredQty,
        multiplier,
        qty,
        value: qty * cv,
      });
    });
    return Object.values(map).sort((a: any, b: any) => b.value - a.value);
  }, [closingData]);

  const colSpan = isSuperAdmin ? 6 : 5;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Boxes className="h-4 w-4 text-violet-600" />
          Department Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3">
          <div>
            <Label className="text-xs">Closing Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
          </div>
        </div>

        {isMobile ? (
          <div className="space-y-2">
            {isLoading ? (
              <Card><CardContent className="p-6 text-center text-sm">Loading…</CardContent></Card>
            ) : departmentBreakdown.length === 0 ? (
              <Card><CardContent className="p-6 text-center text-muted-foreground text-sm">No closing entries for this date.</CardContent></Card>
            ) : departmentBreakdown.map((d: any) => {
              const isOpen = expandedDepts.has(d.name);
              const sortedRows = [...d.rows].sort((a: any, b: any) =>
                isSuperAdmin ? b.value - a.value : b.qty - a.qty
              );
              return (
                <Card key={d.name}>
                  <CardContent className="p-3 space-y-2">
                    <button
                      type="button"
                      onClick={() => toggleDept(d.name)}
                      className="w-full flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        <span className="font-medium text-sm truncate text-left">{d.name}</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">{fmtNum(d.items)} items</Badge>
                    </button>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">Entered</div>
                        <div className="font-mono font-semibold">{fmtNum(d.enteredQty)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Total Qty</div>
                        <div className="font-mono font-semibold">{fmtNum(d.qty)}</div>
                      </div>
                      {isSuperAdmin && (
                        <div className="text-right">
                          <div className="text-muted-foreground">Value</div>
                          <div className="font-mono font-semibold">{fmtCurrency(d.value)}</div>
                        </div>
                      )}
                    </div>
                    {isOpen && (
                      <div className="mt-2 border-t pt-2 space-y-1.5">
                        {sortedRows.map((r: any, idx: number) => (
                          <div key={`${d.name}-${idx}`} className="rounded bg-muted/40 p-2 space-y-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-xs font-medium truncate">{r.name}</div>
                                <div className="text-[10px] font-mono text-muted-foreground">{r.code} · {r.unit}</div>
                              </div>
                              {isSuperAdmin && <div className="text-[11px] font-mono font-semibold">{fmtCurrency(r.value)}</div>}
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-[11px]">
                              <div><span className="text-muted-foreground">Ent: </span><span className="font-mono">{fmtNum(r.enteredQty)}</span></div>
                              <div><span className="text-muted-foreground">x </span><span className="font-mono">{r.multiplier}</span></div>
                              <div className="text-right"><span className="text-muted-foreground">Qty: </span><span className="font-mono">{fmtNum(r.qty)}</span></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
        <div className="overflow-x-auto border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Department</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Entered Qty</TableHead>
                <TableHead className="text-right">Total Qty</TableHead>
                {isSuperAdmin && <TableHead className="text-right">Stock Value</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={colSpan} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
              ) : departmentBreakdown.length === 0 ? (
                <TableRow><TableCell colSpan={colSpan} className="text-center text-muted-foreground py-6">No closing entries for this date.</TableCell></TableRow>
              ) : (
                departmentBreakdown.map((d: any) => {
                  const isOpen = expandedDepts.has(d.name);
                  const sortedRows = [...d.rows].sort((a: any, b: any) =>
                    isSuperAdmin ? b.value - a.value : b.qty - a.qty
                  );
                  return (
                    <Fragment key={d.name}>
                      <TableRow className="cursor-pointer" onClick={() => toggleDept(d.name)}>
                        <TableCell className="w-10 p-2">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleDept(d.name); }}
                            className="p-1 hover:bg-muted rounded"
                            aria-label={isOpen ? "Collapse" : "Expand"}
                          >
                            {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </button>
                        </TableCell>
                        <TableCell className="font-medium">{d.name}</TableCell>
                        <TableCell className="text-right">{fmtNum(d.items)}</TableCell>
                        <TableCell className="text-right">{fmtNum(d.enteredQty)}</TableCell>
                        <TableCell className="text-right">{fmtNum(d.qty)}</TableCell>
                        {isSuperAdmin && <TableCell className="text-right font-semibold">{fmtCurrency(d.value)}</TableCell>}
                      </TableRow>
                      {isOpen && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={colSpan} className="p-0">
                            <div className="overflow-x-auto p-3">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="text-xs uppercase">Code</TableHead>
                                    <TableHead className="text-xs uppercase">Item</TableHead>
                                    <TableHead className="text-xs uppercase">Unit</TableHead>
                                    <TableHead className="text-xs uppercase text-right">Entered</TableHead>
                                    <TableHead className="text-xs uppercase text-right">Mult.</TableHead>
                                    <TableHead className="text-xs uppercase text-right">Qty</TableHead>
                                    {isSuperAdmin && <TableHead className="text-xs uppercase text-right">Value</TableHead>}
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {sortedRows.map((r: any, idx: number) => (
                                    <TableRow key={`${d.name}-${idx}`}>
                                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                                      <TableCell>{r.name}</TableCell>
                                      <TableCell className="text-xs text-muted-foreground">{r.unit}</TableCell>
                                      <TableCell className="text-right">{fmtNum(r.enteredQty)}</TableCell>
                                      <TableCell className="text-right">{r.multiplier}</TableCell>
                                      <TableCell className="text-right">{fmtNum(r.qty)}</TableCell>
                                      {isSuperAdmin && <TableCell className="text-right">{fmtCurrency(r.value)}</TableCell>}
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Page ---------------- */
export default function StoreManagementPage() {
  return (
    <ERPLayout>
      <PageHeader
        title="Store Management"
        description="Material receipts and end-of-day department stock summary"
        icon={Warehouse}
        iconColor="bg-amber-500/10 text-amber-600"
      />
      <div className="space-y-4">
        <MaterialReceivedSection />
        <DepartmentSummarySection />
      </div>
    </ERPLayout>
  );
}
