import { useState, useMemo } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";

export default function LabourProductivityEditRequestsPage() {
  const queryClient = useQueryClient();
  const { user, roles } = useAuth();
  // Read the role list directly: hasRole() answers true for a super_admin no matter which
  // role is asked, which made `isPoster` true for super admins and hid the review actions
  // from them. These flags must mean "actually holds this role".
  const roleNames = roles.map((r) => r.role as string);
  const isSuperAdmin = roleNames.includes('super_admin');
  const isApprover = roleNames.includes('labour_productivity_approver');
  // Roles grant, they do not veto. Holding the poster role must not cancel out an
  // approver role granted alongside it — the labour manager holds both, and an earlier
  // `&& !isPoster` guard silently left that account unable to approve anything.
  // A poster WITHOUT the approver role still cannot review: raising edit requests and
  // approving them stay separate unless someone is explicitly granted both.
  const canReview = isSuperAdmin || isApprover;
  const [rejectDialog, setRejectDialog] = useState<any>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  // History filters
  const [filterDepartment, setFilterDepartment] = useState<string>("all");
  const [filterRequester, setFilterRequester] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");

  const { data: requests, isLoading } = useQuery({
    queryKey: ["labour-edit-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labour_productivity_edit_requests" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Collect IDs for client-side joins
  const entryIds = useMemo(
    () => Array.from(new Set((requests || []).map((r: any) => r.entry_id).filter(Boolean))),
    [requests]
  );
  const userIds = useMemo(() => {
    const ids = new Set<string>();
    (requests || []).forEach((r: any) => {
      if (r.requested_by) ids.add(r.requested_by);
      if (r.reviewed_by) ids.add(r.reviewed_by);
    });
    return Array.from(ids);
  }, [requests]);

  // Collect all referenced process / department / employee IDs (current snapshot + requested)
  const refIds = useMemo(() => {
    const procIds = new Set<string>();
    const deptIds = new Set<string>();
    const empIds = new Set<string>();
    (requests || []).forEach((r: any) => {
      [r.current_process_id, r.requested_process_id].forEach((id) => id && procIds.add(id));
      [r.current_department_id, r.requested_department_id].forEach((id) => id && deptIds.add(id));
      [r.current_employee_id, r.requested_employee_id].forEach((id) => id && empIds.add(id));
    });
    return {
      procIds: Array.from(procIds),
      deptIds: Array.from(deptIds),
      empIds: Array.from(empIds),
    };
  }, [requests]);

  const { data: entries = [] } = useQuery({
    queryKey: ["labour-edit-requests-entries", entryIds],
    enabled: entryIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labour_productivity_targets")
        .select(`id, target_date, actual_quantity, remarks, status, employee_id, department_id, process_id, target_quantity,
          labour_employees(id, full_name, employee_code),
          production_departments(id, name),
          qa_processes(id, name)`)
        .in("id", entryIds);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: appUsers = [] } = useQuery({
    queryKey: ["labour-edit-requests-users", userIds],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_users")
        .select("id, full_name")
        .in("id", userIds);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: refProcesses = [] } = useQuery({
    queryKey: ["labour-edit-requests-procs", refIds.procIds],
    enabled: refIds.procIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_processes")
        .select("id, name")
        .in("id", refIds.procIds);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: refDepartments = [] } = useQuery({
    queryKey: ["labour-edit-requests-depts", refIds.deptIds],
    enabled: refIds.deptIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name")
        .in("id", refIds.deptIds);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: refEmployees = [] } = useQuery({
    queryKey: ["labour-edit-requests-emps", refIds.empIds],
    enabled: refIds.empIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labour_employees")
        .select("id, full_name, employee_code")
        .in("id", refIds.empIds);
      if (error) throw error;
      return data || [];
    },
  });

  const entryById = useMemo(() => {
    const map = new Map<string, any>();
    entries.forEach((e: any) => map.set(e.id, e));
    return map;
  }, [entries]);

  const userById = useMemo(() => {
    const map = new Map<string, any>();
    appUsers.forEach((u: any) => map.set(u.id, u));
    return map;
  }, [appUsers]);

  const processById = useMemo(() => {
    const map = new Map<string, string>();
    refProcesses.forEach((p: any) => map.set(p.id, p.name));
    return map;
  }, [refProcesses]);

  const departmentById = useMemo(() => {
    const map = new Map<string, string>();
    refDepartments.forEach((d: any) => map.set(d.id, d.name));
    return map;
  }, [refDepartments]);

  const employeeById = useMemo(() => {
    const map = new Map<string, string>();
    refEmployees.forEach((e: any) => map.set(e.id, `${e.full_name} (${e.employee_code})`));
    return map;
  }, [refEmployees]);

  // Build enriched rows
  const enriched = useMemo(() => {
    return (requests || []).map((r: any) => {
      const entry = entryById.get(r.entry_id);
      return {
        ...r,
        entry,
        requesterName: r.requested_by ? userById.get(r.requested_by)?.full_name || "-" : "-",
        reviewerName: r.reviewed_by ? userById.get(r.reviewed_by)?.full_name || "-" : null,
      };
    });
  }, [requests, entryById, userById]);

  // Build the list of "Field: current → requested" change lines for a request
  // Only show the 4 supported fields: Department, Process, Today Target, MPH
  const buildChanges = (r: any): Array<{ field: string; from: string; to: string }> => {
    const changes: Array<{ field: string; from: string; to: string }> = [];
    if (r.requested_department_id) {
      changes.push({
        field: "Department",
        from: r.current_department_id ? departmentById.get(r.current_department_id) || "-" : "-",
        to: departmentById.get(r.requested_department_id) || "-",
      });
    }
    if (r.requested_process_id) {
      changes.push({
        field: "Process",
        from: r.current_process_id ? processById.get(r.current_process_id) || "-" : "-",
        to: processById.get(r.requested_process_id) || "-",
      });
    }
    if (r.requested_standard_target !== null && r.requested_standard_target !== undefined) {
      changes.push({
        field: "Today Target",
        from: String(r.current_standard_target ?? "-"),
        to: String(r.requested_standard_target),
      });
    }
    if (r.requested_mph !== null && r.requested_mph !== undefined) {
      changes.push({
        field: "MPH",
        from: String(r.current_mph ?? "-"),
        to: String(r.requested_mph),
      });
    }
    return changes;
  };

  const approveMutation = useMutation({
    mutationFn: async (request: any) => {
      // Build dynamic update payload — only the 4 supported fields
      const updatePayload: any = {};
      if (request.requested_department_id) updatePayload.department_id = request.requested_department_id;
      if (request.requested_process_id) updatePayload.process_id = request.requested_process_id;
      if (request.requested_standard_target !== null && request.requested_standard_target !== undefined) {
        updatePayload.target_quantity = request.requested_standard_target;
      }
      // MPH is a generated column derived from work_type (full_day=12, half_day=6).
      // Translate the requested MPH value into the corresponding work_type.
      if (request.requested_mph !== null && request.requested_mph !== undefined) {
        const reqMph = Number(request.requested_mph);
        if (reqMph >= 12) {
          updatePayload.work_type = "full_day";
        } else if (reqMph > 0) {
          updatePayload.work_type = "half_day";
        }
      }

      if (Object.keys(updatePayload).length > 0) {
        const { error: entryError } = await supabase
          .from("labour_productivity_targets")
          .update(updatePayload)
          .eq("id", request.entry_id);
        if (entryError) throw entryError;
      }

      // Update request status
      const { error: reqError } = await supabase
        .from("labour_productivity_edit_requests" as any)
        .update({
          status: "approved",
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
        } as any)
        .eq("id", request.id);
      if (reqError) throw reqError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labour-edit-requests"] });
      queryClient.invalidateQueries({ queryKey: ["labour-productivity-entries"] });
      queryClient.invalidateQueries({ queryKey: ["labour-edit-requests-pending-map"] });
      toast.success("Request approved — entry updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const { error } = await supabase
        .from("labour_productivity_edit_requests" as any)
        .update({
          status: "rejected",
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
          review_notes: notes || null,
        } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labour-edit-requests"] });
      queryClient.invalidateQueries({ queryKey: ["labour-edit-requests-pending-map"] });
      toast.success("Request rejected");
      setRejectDialog(null);
      setRejectNotes("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendingRequests = enriched.filter((r: any) => r.status === "pending");
  const historyRequests = enriched.filter((r: any) => r.status !== "pending");

  // Distinct departments / requesters from history for filter
  const historyDepartments = useMemo(() => {
    const map = new Map<string, string>();
    historyRequests.forEach((r: any) => {
      const d = r.entry?.production_departments;
      if (d?.id) map.set(d.id, d.name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [historyRequests]);

  const historyRequesters = useMemo(() => {
    const map = new Map<string, string>();
    historyRequests.forEach((r: any) => {
      if (r.requested_by) map.set(r.requested_by, r.requesterName);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [historyRequests]);

  const filteredHistory = historyRequests.filter((r: any) => {
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (filterDepartment !== "all" && r.entry?.department_id !== filterDepartment) return false;
    if (filterRequester !== "all" && r.requested_by !== filterRequester) return false;
    if (filterFrom && r.entry?.target_date && r.entry.target_date < filterFrom) return false;
    if (filterTo && r.entry?.target_date && r.entry.target_date > filterTo) return false;
    return true;
  });

  const renderChangesCell = (r: any) => {
    const changes = buildChanges(r);
    if (changes.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
    return (
      <div className="space-y-1 text-xs">
        {changes.map((c, i) => (
          <div key={i} className="leading-tight">
            <span className="font-semibold">{c.field}:</span>{" "}
            <span className="text-muted-foreground line-through">{c.from}</span>{" "}
            <span className="text-primary font-semibold">→ {c.to}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderTable = (items: any[], showActions: boolean) => (
    <div className="border rounded-lg overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Entry Date</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Process</TableHead>
            <TableHead>Employee</TableHead>
            <TableHead className="min-w-[260px]">Changes</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Requested By</TableHead>
            <TableHead>Requested At</TableHead>
            {showActions ? <TableHead>Actions</TableHead> : <TableHead>Status / Reviewer</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                No requests found
              </TableCell>
            </TableRow>
          ) : (
            items.map((r: any) => {
              const entry = r.entry;
              return (
                <TableRow key={r.id}>
                  <TableCell>{entry?.target_date ? format(new Date(entry.target_date), "dd MMM yyyy") : "-"}</TableCell>
                  <TableCell>{entry?.production_departments?.name || "-"}</TableCell>
                  <TableCell>{entry?.qa_processes?.name || "-"}</TableCell>
                  <TableCell>
                    {entry?.labour_employees?.full_name || "-"}
                    {entry?.labour_employees?.employee_code && (
                      <span className="text-xs text-muted-foreground ml-1">({entry.labour_employees.employee_code})</span>
                    )}
                  </TableCell>
                  <TableCell>{renderChangesCell(r)}</TableCell>
                  <TableCell className="max-w-[240px] truncate" title={r.reason}>{r.reason}</TableCell>
                  <TableCell>{r.requesterName}</TableCell>
                  <TableCell>{format(new Date(r.created_at), "dd MMM yyyy HH:mm")}</TableCell>
                  {showActions ? (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => approveMutation.mutate(r)}
                          disabled={approveMutation.isPending}
                        >
                          <Check className="h-4 w-4 mr-1" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setRejectDialog(r)}
                        >
                          <X className="h-4 w-4 mr-1" /> Reject
                        </Button>
                      </div>
                    </TableCell>
                  ) : (
                    <TableCell>
                      <Badge className={r.status === "approved" ? "bg-green-600" : "bg-red-600"}>
                        {r.status}
                      </Badge>
                      {r.reviewerName && (
                        <p className="text-xs text-muted-foreground mt-1">
                          by {r.reviewerName}{r.reviewed_at && ` · ${format(new Date(r.reviewed_at), "dd MMM yyyy HH:mm")}`}
                        </p>
                      )}
                      {r.review_notes && (
                        <p className="text-xs text-muted-foreground mt-1 italic">"{r.review_notes}"</p>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Labour Productivity Edit Requests"
          description="Review and track requests to edit labour productivity entries"
        />

        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">
              Pending {pendingRequests.length > 0 && (
                <Badge className="ml-2 bg-amber-500">{pendingRequests.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="mt-4">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading…</div>
            ) : (
              renderTable(pendingRequests, canReview)
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 p-3 border rounded-lg bg-muted/30">
              <div>
                <Label className="text-xs">Department</Label>
                <Select value={filterDepartment} onValueChange={setFilterDepartment}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {historyDepartments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Requester</Label>
                <Select value={filterRequester} onValueChange={setFilterRequester}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {historyRequesters.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">From (entry date)</Label>
                <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">To (entry date)</Label>
                <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
              </div>
            </div>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading…</div>
            ) : (
              renderTable(filteredHistory, false)
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Reject Dialog */}
      <Dialog open={!!rejectDialog} onOpenChange={() => { setRejectDialog(null); setRejectNotes(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Edit Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Rejection Notes (optional)</Label>
              <Textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="Reason for rejection…"
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setRejectDialog(null); setRejectNotes(""); }}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => rejectMutation.mutate({ id: rejectDialog.id, notes: rejectNotes })}
                disabled={rejectMutation.isPending}
              >
                Reject
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
