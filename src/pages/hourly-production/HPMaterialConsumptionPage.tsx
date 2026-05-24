import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PackageCheck, Save } from "lucide-react";
import { toast } from "sonner";
import { format, subDays, addDays, parseISO } from "date-fns";

interface RowState {
  material_id: string;
  opening: number;
  issuedToday: number;
  consumed: string;
  itemIds: string[]; // accepted items today for this material
}

export default function HPMaterialConsumptionPage() {
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const [date, setDate] = useState(today);
  const [departmentId, setDepartmentId] = useState<string>("");
  const [consumedMap, setConsumedMap] = useState<Record<string, string>>({});

  const prevDate = format(subDays(parseISO(date), 1), "yyyy-MM-dd");

  const { data: eligibleDepts = [] } = useQuery({
    queryKey: ["hp-cons-eligible-depts"],
    queryFn: async () => {
      const { data: eligible } = await supabase.from("job_order_eligible_departments").select("department_id");
      const ids = (eligible || []).map((r: any) => r.department_id);
      if (ids.length === 0) return [];
      const { data } = await supabase.from("production_departments").select("id, name").in("id", ids).eq("is_active", true).order("name");
      return data || [];
    },
  });

  const { data: materials = [] } = useQuery({
    queryKey: ["hp-materials-active"],
    queryFn: async () => {
      const { data } = await supabase.from("hp_materials").select("id, code, name, unit").eq("is_active", true).order("code");
      return data || [];
    },
  });
  const materialMap = useMemo(() => Object.fromEntries(materials.map((m: any) => [m.id, m])), [materials]);

  // Today's issuance headers for department
  const { data: todayHeaders = [] } = useQuery({
    queryKey: ["hp-cons-today-headers", date, departmentId],
    queryFn: async () => {
      if (!departmentId) return [];
      const { data } = await supabase.from("hp_material_issuance").select("id, notes").eq("issue_date", date).eq("department_id", departmentId);
      return data || [];
    },
    enabled: !!departmentId,
  });

  // Carry-forward (auto reissuance) headers for today
  const carryHeaderIds = (todayHeaders as any[]).filter(h => h.notes === "Last Day Balance Reissuance").map(h => h.id);
  const { data: carryItems = [] } = useQuery({
    queryKey: ["hp-cons-carry-items", carryHeaderIds.join(",")],
    queryFn: async () => {
      if (carryHeaderIds.length === 0) return [];
      const { data } = await supabase.from("hp_material_issuance_items").select("*").in("issuance_id", carryHeaderIds);
      return data || [];
    },
    enabled: carryHeaderIds.length > 0,
  });

  const carryByMaterial = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of carryItems as any[]) {
      m[it.material_id] = (m[it.material_id] || 0) + Number(it.issued_qty || 0);
    }
    return m;
  }, [carryItems]);

  // Previous day's issuance headers for department (to compute opening)
  const { data: prevHeaders = [] } = useQuery({
    queryKey: ["hp-cons-prev-headers", prevDate, departmentId],
    queryFn: async () => {
      if (!departmentId) return [];
      const { data } = await supabase.from("hp_material_issuance").select("id").eq("issue_date", prevDate).eq("department_id", departmentId);
      return data || [];
    },
    enabled: !!departmentId,
  });

  // Regular (non-carry) today header IDs — carry headers are handled separately as Opening
  const regularTodayHdrIds = (todayHeaders as any[])
    .filter(h => h.notes !== "Last Day Balance Reissuance")
    .map(h => h.id);
  const prevHdrIds = prevHeaders.map((h: any) => h.id);

  const { data: todayItems = [] } = useQuery({
    queryKey: ["hp-cons-today-items", regularTodayHdrIds.join(",")],
    queryFn: async () => {
      if (regularTodayHdrIds.length === 0) return [];
      const { data } = await supabase.from("hp_material_issuance_items").select("*").in("issuance_id", regularTodayHdrIds).in("status", ["accepted", "closed"]);
      return data || [];
    },
    enabled: regularTodayHdrIds.length > 0,
  });

  const { data: prevItems = [] } = useQuery({
    queryKey: ["hp-cons-prev-items", prevHdrIds.join(",")],
    queryFn: async () => {
      if (prevHdrIds.length === 0) return [];
      const { data } = await supabase.from("hp_material_issuance_items").select("*").in("issuance_id", prevHdrIds).in("status", ["accepted", "closed"]);
      return data || [];
    },
    enabled: prevHdrIds.length > 0,
  });

  // Build row state by material
  const rows: RowState[] = useMemo(() => {
    const byMat: Record<string, RowState> = {};
    // Today's regular issuances
    for (const it of todayItems as any[]) {
      const m = it.material_id;
      if (!byMat[m]) byMat[m] = { material_id: m, opening: 0, issuedToday: 0, consumed: "", itemIds: [] };
      byMat[m].issuedToday += Number(it.issued_qty || 0);
      byMat[m].itemIds.push(it.id);
    }
    // Opening from carry-forward (preferred) — these items hold yesterday's balance, also consumable
    const carryMatIds = new Set<string>();
    for (const it of carryItems as any[]) {
      const m = it.material_id;
      carryMatIds.add(m);
      if (!byMat[m]) byMat[m] = { material_id: m, opening: 0, issuedToday: 0, consumed: "", itemIds: [] };
      byMat[m].opening += Number(it.issued_qty || 0);
      byMat[m].itemIds.push(it.id);
    }
    // Fallback opening from prev-day items when no carry exists for that material
    for (const it of prevItems as any[]) {
      const m = it.material_id;
      if (carryMatIds.has(m)) continue;
      if (!byMat[m]) byMat[m] = { material_id: m, opening: 0, issuedToday: 0, consumed: "", itemIds: [] };
      byMat[m].opening += Number(it.issued_qty || 0) - Number(it.consumed_qty || 0);
    }
    return Object.values(byMat).sort((a, b) =>
      (materialMap[a.material_id]?.code || "").localeCompare(materialMap[b.material_id]?.code || "")
    );
  }, [todayItems, carryItems, prevItems, materialMap]);

  // Preload consumed from existing items (sum across today's regular + carry items)
  // but do not wipe user-typed values while they are editing.
  useEffect(() => {
    const sums: Record<string, number> = {};
    for (const it of [...(todayItems as any[]), ...(carryItems as any[])]) {
      if (it.consumed_qty != null) {
        sums[it.material_id] = (sums[it.material_id] || 0) + Number(it.consumed_qty);
      }
    }

    setConsumedMap((prev) => {
      const next: Record<string, string> = {};

      for (const r of rows) {
        const materialId = r.material_id;
        if (prev[materialId] !== undefined) {
          next[materialId] = prev[materialId];
        } else if (sums[materialId] !== undefined) {
          next[materialId] = String(sums[materialId]);
        } else {
          next[materialId] = "";
        }
      }

      return next;
    });
  }, [todayItems, carryItems, rows]);

  const save = useMutation({
    mutationFn: async () => {
      // 1) Distribute consumed across today's regular + carry items proportionally to issued_qty
      const allHoldingItems = [...(todayItems as any[]), ...(carryItems as any[])];
      const CARRY_NOTE = "Last Day Balance Reissuance";
      const { data: authData } = await supabase.auth.getUser();
      const currentUserId = authData?.user?.id;
      for (const r of rows) {
        const consumedRaw = consumedMap[r.material_id];
        if (consumedRaw === undefined || consumedRaw === "") continue;
        const totalConsumed = Number(consumedRaw);
        if (isNaN(totalConsumed)) continue;
        let items = allHoldingItems.filter(i => r.itemIds.includes(i.id));

        // If no holding items today but there's an opening (from prev-day fallback),
        // create today's carry-forward header+item so consumption can be recorded.
        if (items.length === 0 && r.opening > 0) {
          // Receiver: pick from prev-day items for this material, else current user
          const prevForMat = (prevItems as any[]).filter(i => i.material_id === r.material_id);
          const receiverId = prevForMat[0]?.receiver_user_id || currentUserId;
          if (!receiverId) continue;

          let hdrId: string | null = null;
          const { data: existingHdrs } = await supabase
            .from("hp_material_issuance")
            .select("id")
            .eq("issue_date", date)
            .eq("department_id", departmentId)
            .eq("notes", CARRY_NOTE);
          if (existingHdrs && existingHdrs.length > 0) {
            hdrId = existingHdrs[0].id;
          } else {
            const { data: newHdr, error: hdrErr } = await supabase
              .from("hp_material_issuance")
              .insert({ issue_date: date, department_id: departmentId, issued_by: currentUserId, notes: CARRY_NOTE })
              .select("id")
              .single();
            if (hdrErr) throw hdrErr;
            hdrId = newHdr!.id;
          }
          const { data: newItem, error: itemErr } = await supabase
            .from("hp_material_issuance_items")
            .insert({ issuance_id: hdrId, material_id: r.material_id, issued_qty: r.opening, receiver_user_id: receiverId, status: "accepted" })
            .select("*")
            .single();
          if (itemErr) throw itemErr;
          items = [newItem];
        }

        const totalIssued = items.reduce((s, i) => s + Number(i.issued_qty || 0), 0) || 1;
        let allocated = 0;
        for (let idx = 0; idx < items.length; idx++) {
          const it = items[idx];
          let portion: number;
          if (idx === items.length - 1) {
            portion = Math.max(totalConsumed - allocated, 0);
          } else {
            portion = (Number(it.issued_qty || 0) / totalIssued) * totalConsumed;
            allocated += portion;
          }
          const { error } = await supabase
            .from("hp_material_issuance_items")
            .update({ consumed_qty: portion, status: "closed", closed_at: new Date().toISOString() })
            .eq("id", it.id);
          if (error) throw error;
        }
      }

      // 2) Carry-forward: post leftover balance as next-day "Last Day Balance Reissuance"
      const nextDate = format(addDays(parseISO(date), 1), "yyyy-MM-dd");

      // Find or create next-day carry-forward header for this department
      let carryHeaderId: string | null = null;
      const { data: existingHdrs } = await supabase
        .from("hp_material_issuance")
        .select("id")
        .eq("issue_date", nextDate)
        .eq("department_id", departmentId)
        .eq("notes", CARRY_NOTE);
      if (existingHdrs && existingHdrs.length > 0) {
        carryHeaderId = existingHdrs[0].id;
      }

      // Collect carry rows to insert
      const carryRows: any[] = [];
      for (const r of rows) {
        const consumedRaw = consumedMap[r.material_id];
        const consumed = consumedRaw === undefined || consumedRaw === "" ? 0 : Number(consumedRaw);
        const balance = r.opening + r.issuedToday - (isNaN(consumed) ? 0 : consumed);
        if (balance <= 0.0001) continue;

        // Pick receiver from today's regular item (most recent) for this material; fallback to carry item
        const todaysForMat = [...(todayItems as any[]), ...(carryItems as any[])].filter(i => i.material_id === r.material_id);
        const receiverId =
          todaysForMat.sort((a, b) =>
            new Date(b.accepted_at || b.created_at).getTime() - new Date(a.accepted_at || a.created_at).getTime()
          )[0]?.receiver_user_id || todaysForMat[0]?.receiver_user_id;

        if (!receiverId) continue; // cannot create without a receiver

        carryRows.push({
          material_id: r.material_id,
          issued_qty: balance,
          receiver_user_id: receiverId,
          status: "accepted",
          accepted_by: receiverId,
          accepted_at: new Date().toISOString(),
          remarks: `Auto carry-forward from ${date}`,
        });
      }

      // If header exists, wipe its items first (idempotency)
      if (carryHeaderId) {
        await supabase.from("hp_material_issuance_items").delete().eq("issuance_id", carryHeaderId);
      }

      if (carryRows.length > 0) {
        if (!carryHeaderId) {
          const { data: newHdr, error: hdrErr } = await supabase
            .from("hp_material_issuance")
            .insert({ issue_date: nextDate, department_id: departmentId, notes: CARRY_NOTE })
            .select("id")
            .single();
          if (hdrErr) throw hdrErr;
          carryHeaderId = newHdr!.id;
        }
        const itemsPayload = carryRows.map(r => ({ ...r, issuance_id: carryHeaderId }));
        const { error: insErr } = await supabase.from("hp_material_issuance_items").insert(itemsPayload);
        if (insErr) throw insErr;
      } else if (carryHeaderId) {
        // No carry rows; remove empty header
        await supabase.from("hp_material_issuance").delete().eq("id", carryHeaderId);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hp-cons-today-items"] });
      qc.invalidateQueries({ queryKey: ["hp-cons-prev-items"] });
      qc.invalidateQueries({ queryKey: ["hp-cons-carry-items"] });
      qc.invalidateQueries({ queryKey: ["hp-cons-today-headers"] });
      qc.invalidateQueries({ queryKey: ["hp-cons-prev-headers"] });
      qc.invalidateQueries({ queryKey: ["hp-issuance-items"] });
      qc.invalidateQueries({ queryKey: ["hp-issuance-list"] });
      toast.success("Saved. Balance carried forward as next-day reissuance.");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <ERPLayout>
      <PageHeader title="Daily Material Consumption" description="Enter end-of-day consumed quantity; balance auto-carries to next day" icon={PackageCheck} />

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><Label>Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div>
              <Label>Department *</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {eligibleDepts.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={() => save.mutate()} disabled={!departmentId || rows.length === 0 || save.isPending}>
                <Save className="h-4 w-4 mr-2" /> Save Closing
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {departmentId && Object.keys(carryByMaterial).length > 0 && (
        <Card className="mt-4 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="text-amber-900 dark:text-amber-200 text-base">
              Yesterday's Carry-Forward (Reissued Today)
            </CardTitle>
            <p className="text-xs text-amber-800 dark:text-amber-300/80">
              Auto-posted as accepted issuance with note "Last Day Balance Reissuance".
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right">Carried Qty</TableHead>
                  <TableHead>Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(carryByMaterial)
                  .sort((a, b) => (materialMap[a[0]]?.code || "").localeCompare(materialMap[b[0]]?.code || ""))
                  .map(([matId, qty]) => {
                    const m = materialMap[matId];
                    return (
                      <TableRow key={matId}>
                        <TableCell className="font-mono">{m?.code}</TableCell>
                        <TableCell className="font-medium">{m?.name}</TableCell>
                        <TableCell className="text-right font-semibold">{qty.toFixed(2)}</TableCell>
                        <TableCell>{m?.unit}</TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader><CardTitle>Materials</CardTitle></CardHeader>
        <CardContent>
          {!departmentId ? (
            <p className="text-muted-foreground text-sm">Select a department to view materials.</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No accepted issuances for this date / department, and no carry-over from yesterday.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Opening (from yesterday's balance)</TableHead>
                  <TableHead className="text-right">Issued Today</TableHead>
                  <TableHead className="text-right">Consumed</TableHead>
                  <TableHead className="text-right">Balance (carry forward)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => {
                  const m = materialMap[r.material_id];
                  const consumed = Number(consumedMap[r.material_id] || 0);
                  const balance = r.opening + r.issuedToday - consumed;
                  const disabled = r.itemIds.length === 0 && r.opening <= 0; // nothing to consume against
                  return (
                    <TableRow key={r.material_id}>
                      <TableCell className="font-mono">{m?.code}</TableCell>
                      <TableCell className="font-medium">{m?.name}</TableCell>
                      <TableCell>{m?.unit}</TableCell>
                      <TableCell className="text-right">{r.opening.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{r.issuedToday.toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.01"
                          className="w-28 text-right ml-auto"
                          disabled={disabled}
                          value={consumedMap[r.material_id] ?? ""}
                          onChange={e => setConsumedMap(prev => ({ ...prev, [r.material_id]: e.target.value }))}
                          placeholder={disabled ? "—" : "0"}
                        />
                      </TableCell>
                      <TableCell className="text-right font-semibold">{balance.toFixed(2)} {m?.unit}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ERPLayout>
  );
}
