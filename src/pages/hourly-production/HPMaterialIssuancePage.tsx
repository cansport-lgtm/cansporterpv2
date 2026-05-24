import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClipboardList, Plus, Trash2, Check, X, Send } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { format, parseISO } from "date-fns";

interface LineDraft {
  material_id: string;
  issued_qty: string;
  receiver_user_id: string;
  remarks: string;
}

const blankLine = (): LineDraft => ({ material_id: "", issued_qty: "", receiver_user_id: "", remarks: "" });

export default function HPMaterialIssuancePage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const today = format(new Date(), "yyyy-MM-dd");

  const [issueDate, setIssueDate] = useState(today);
  const [departmentId, setDepartmentId] = useState<string>("");
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [notes, setNotes] = useState("");

  const { data: eligibleDepts = [] } = useQuery({
    queryKey: ["hp-issue-eligible-depts"],
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

  const { data: users = [] } = useQuery({
    queryKey: ["hp-eligible-users"],
    queryFn: async () => {
      const [{ data: allUsers }, { data: roles }, { data: perms }] = await Promise.all([
        supabase.from("app_users").select("id, full_name, user_id").eq("is_active", true).order("full_name"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("module_permissions").select("user_id, can_view").eq("module_name", "hourly_production"),
      ]);
      // Roles that grant hourly_production access by default (and aren't hard-restricted away from it)
      const GENERAL_ROLES = new Set(["super_admin", "admin", "manager", "supervisor"]);
      const FLOOR_INCHARGE = "floor_incharge";
      const HARD_RESTRICTED = new Set([
        "qa_manager", "maintenance_manager", "operator", "sales_executive",
        "order_management", "private_label_distributor", "pettycash_handler",
        "store_operator", "project_manager", "online_sales_packing",
      ]);
      const rolesByUser: Record<string, string[]> = {};
      for (const r of roles || []) {
        (rolesByUser[(r as any).user_id] ||= []).push((r as any).role);
      }
      const explicitGrant = new Set(
        (perms || []).filter((p: any) => p.can_view).map((p: any) => p.user_id as string)
      );
      const eligible = (allUsers || []).filter((u: any) => {
        if (explicitGrant.has(u.id)) return true;
        const rs = rolesByUser[u.id] || [];
        if (rs.includes(FLOOR_INCHARGE)) return true;
        // General role only counts if user has at least one non-hard-restricted general role
        return rs.some(r => GENERAL_ROLES.has(r) && !HARD_RESTRICTED.has(r));
      });
      return eligible;
    },
  });

  const userMap = useMemo(() => Object.fromEntries(users.map((u: any) => [u.id, u.full_name])), [users]);
  const materialMap = useMemo(() => Object.fromEntries(materials.map((m: any) => [m.id, m])), [materials]);

  // List of issuances + items
  const { data: issuances = [] } = useQuery({
    queryKey: ["hp-issuances-list", issueDate, departmentId],
    queryFn: async () => {
      let q = supabase.from("hp_material_issuance").select("*").eq("issue_date", issueDate).order("created_at", { ascending: false });
      if (departmentId) q = q.eq("department_id", departmentId);
      const { data } = await q;
      return data || [];
    },
    enabled: !!issueDate,
  });

  const issuanceIds = issuances.map((i: any) => i.id);
  const { data: allItems = [] } = useQuery({
    queryKey: ["hp-issuance-items", issuanceIds.join(",")],
    queryFn: async () => {
      if (issuanceIds.length === 0) return [];
      const { data } = await supabase.from("hp_material_issuance_items").select("*").in("issuance_id", issuanceIds);
      return data || [];
    },
    enabled: issuanceIds.length > 0,
  });

  // Pending for me
  const { data: pendingForMe = [] } = useQuery({
    queryKey: ["hp-issuance-pending-me", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from("hp_material_issuance_items")
        .select("*")
        .eq("receiver_user_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!user?.id,
  });

  const pendingIssuanceIds = Array.from(new Set(pendingForMe.map((i: any) => i.issuance_id)));
  const { data: pendingIssuances = [] } = useQuery({
    queryKey: ["hp-pending-issuance-headers", pendingIssuanceIds.join(",")],
    queryFn: async () => {
      if (pendingIssuanceIds.length === 0) return [];
      const { data } = await supabase.from("hp_material_issuance").select("*").in("id", pendingIssuanceIds);
      return data || [];
    },
    enabled: pendingIssuanceIds.length > 0,
  });
  const pendingHeaderMap = Object.fromEntries(pendingIssuances.map((p: any) => [p.id, p]));
  const deptMap = Object.fromEntries(eligibleDepts.map((d: any) => [d.id, d.name]));

  const create = useMutation({
    mutationFn: async () => {
      if (!departmentId) throw new Error("Select a department");
      const valid = lines.filter(l => l.material_id && l.receiver_user_id && Number(l.issued_qty) > 0);
      if (valid.length === 0) throw new Error("Add at least one valid line");
      const { data: header, error: e1 } = await supabase
        .from("hp_material_issuance")
        .insert({ issue_date: issueDate, department_id: departmentId, issued_by: user?.id, notes: notes || null })
        .select()
        .single();
      if (e1) throw e1;
      const itemsPayload = valid.map(l => ({
        issuance_id: header.id,
        material_id: l.material_id,
        issued_qty: Number(l.issued_qty),
        receiver_user_id: l.receiver_user_id,
        remarks: l.remarks || null,
        status: "pending",
      }));
      const { error: e2 } = await supabase.from("hp_material_issuance_items").insert(itemsPayload);
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hp-issuances-list"] });
      qc.invalidateQueries({ queryKey: ["hp-issuance-items"] });
      qc.invalidateQueries({ queryKey: ["hp-issuance-pending-me"] });
      toast.success("Issuance sent for acceptance");
      setLines([blankLine()]);
      setNotes("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const respond = useMutation({
    mutationFn: async ({ itemId, accept }: { itemId: string; accept: boolean }) => {
      const { error } = await supabase
        .from("hp_material_issuance_items")
        .update({
          status: accept ? "accepted" : "rejected",
          accepted_by: user?.id,
          accepted_at: new Date().toISOString(),
        })
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hp-issuance-pending-me"] });
      qc.invalidateQueries({ queryKey: ["hp-issuance-items"] });
      toast.success("Updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteIssuance = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("hp_material_issuance").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hp-issuances-list"] });
      qc.invalidateQueries({ queryKey: ["hp-issuance-items"] });
      toast.success("Deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      pending: "bg-amber-100 text-amber-800",
      accepted: "bg-green-100 text-green-800",
      rejected: "bg-red-100 text-red-800",
      closed: "bg-slate-200 text-slate-800",
    };
    return <Badge className={map[s] || ""}>{s}</Badge>;
  };

  return (
    <ERPLayout>
      <PageHeader title="Material Issuance" description="Issue daily materials to a department; receiver accepts on their login" icon={ClipboardList} />

      <Tabs defaultValue="issue" className="w-full">
        <TabsList>
          <TabsTrigger value="issue">New / List</TabsTrigger>
          <TabsTrigger value="pending">Pending My Acceptance ({pendingForMe.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="issue" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>New Issuance</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div><Label>Date</Label><Input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} /></div>
                <div>
                  <Label>Department *</Label>
                  <Select value={departmentId} onValueChange={setDepartmentId}>
                    <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                    <SelectContent>
                      {eligibleDepts.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
              </div>

              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Material *</TableHead>
                      <TableHead className="w-32">Issued Qty *</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Receiver *</TableHead>
                      <TableHead>Remarks</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <Select value={l.material_id} onValueChange={v => {
                            const next = [...lines]; next[idx].material_id = v; setLines(next);
                          }}>
                            <SelectTrigger><SelectValue placeholder="Material" /></SelectTrigger>
                            <SelectContent>
                              {materials.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.code} - {m.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell><Input type="number" step="0.01" value={l.issued_qty} onChange={e => { const n = [...lines]; n[idx].issued_qty = e.target.value; setLines(n); }} /></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{materialMap[l.material_id]?.unit || "-"}</TableCell>
                        <TableCell>
                          <Select value={l.receiver_user_id} onValueChange={v => { const n = [...lines]; n[idx].receiver_user_id = v; setLines(n); }}>
                            <SelectTrigger><SelectValue placeholder="Receiver" /></SelectTrigger>
                            <SelectContent>
                              {users.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell><Input value={l.remarks} onChange={e => { const n = [...lines]; n[idx].remarks = e.target.value; setLines(n); }} /></TableCell>
                        <TableCell>
                          {lines.length > 1 && <Button size="icon" variant="ghost" onClick={() => setLines(lines.filter((_, i) => i !== idx))}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setLines([...lines, blankLine()])}><Plus className="h-4 w-4 mr-2" /> Add Line</Button>
                <Button onClick={() => create.mutate()} disabled={create.isPending}><Send className="h-4 w-4 mr-2" /> Send for Acceptance</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Issuances on {format(parseISO(issueDate), "PPP")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {issuances.length === 0 && <p className="text-muted-foreground text-sm">No issuances for this date.</p>}
              {issuances.map((iss: any) => {
                const items = allItems.filter((i: any) => i.issuance_id === iss.id);
                const isCarry = iss.notes === "Last Day Balance Reissuance";
                return (
                  <div key={iss.id} className={`border rounded-md p-3 ${isCarry ? "border-l-4 border-l-amber-500 bg-amber-50 dark:bg-amber-950/20" : ""}`}>
                    <div className="flex justify-between items-center mb-2">
                      <div className="text-sm flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{deptMap[iss.department_id] || "—"}</span>
                        {isCarry && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Auto Carry-Forward</Badge>}
                        <span>· Issued by {userMap[iss.issued_by] || (isCarry ? "System" : "—")}</span>
                        {iss.notes && <span className="text-muted-foreground"> · {iss.notes}</span>}
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete this issuance and its items?")) deleteIssuance.mutate(iss.id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Material</TableHead>
                          <TableHead>Issued</TableHead>
                          <TableHead>Receiver</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Consumed</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((it: any) => (
                          <TableRow key={it.id}>
                            <TableCell>{materialMap[it.material_id]?.code} - {materialMap[it.material_id]?.name}</TableCell>
                            <TableCell>{Number(it.issued_qty)} {materialMap[it.material_id]?.unit}</TableCell>
                            <TableCell>{userMap[it.receiver_user_id] || "—"}</TableCell>
                            <TableCell>{statusBadge(it.status)}</TableCell>
                            <TableCell>{it.consumed_qty != null ? `${Number(it.consumed_qty)} ${materialMap[it.material_id]?.unit}` : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pending" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Materials Awaiting My Acceptance</CardTitle></CardHeader>
            <CardContent>
              {pendingForMe.length === 0 ? <p className="text-muted-foreground text-sm">Nothing pending.</p> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead>Issued Qty</TableHead>
                      <TableHead>Issued By</TableHead>
                      <TableHead>Remarks</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingForMe.map((it: any) => {
                      const h = pendingHeaderMap[it.issuance_id];
                      return (
                        <TableRow key={it.id}>
                          <TableCell>{h?.issue_date}</TableCell>
                          <TableCell>{deptMap[h?.department_id] || "—"}</TableCell>
                          <TableCell>{materialMap[it.material_id]?.code} - {materialMap[it.material_id]?.name}</TableCell>
                          <TableCell>{Number(it.issued_qty)} {materialMap[it.material_id]?.unit}</TableCell>
                          <TableCell>{userMap[h?.issued_by] || "—"}</TableCell>
                          <TableCell>{it.remarks || "—"}</TableCell>
                          <TableCell className="text-right space-x-1">
                            <Button size="sm" onClick={() => respond.mutate({ itemId: it.id, accept: true })}><Check className="h-4 w-4 mr-1" />Accept</Button>
                            <Button size="sm" variant="outline" onClick={() => respond.mutate({ itemId: it.id, accept: false })}><X className="h-4 w-4 mr-1" />Reject</Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </ERPLayout>
  );
}
