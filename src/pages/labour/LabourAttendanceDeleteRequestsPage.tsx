import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import { Check, Download, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import {
  type AttendanceDeleteLogRow,
  type AttendanceDeleteRequest,
  type AttendanceDeleteStatus,
  EVENT_CLASS,
  EVENT_LABEL,
  LOG_KEY,
  PENDING_MAP_KEY,
  REQUESTS_KEY,
  STATUS_CLASS,
  STATUS_LABEL,
  cancelAttendanceDeleteRequest,
  formatClock,
  ladDb,
  reviewAttendanceDeleteRequest,
  useAttendanceDeleteAccess,
  workTypeLabel,
} from "@/lib/labourAttendanceDelete";

const fmtDate = (d: string | null | undefined) => (d ? format(new Date(d), "dd MMM yyyy") : "-");
const fmtStamp = (d: string | null | undefined) => (d ? format(new Date(d), "dd MMM yyyy HH:mm") : "-");

const matchesSearch = (q: string, ...parts: Array<string | null | undefined>) => {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return parts.some((p) => (p || "").toLowerCase().includes(needle));
};

/**
 * Labour attendance delete requests: a supervisor's request to delete a worker's
 * attendance entry that was marked by mistake, the approver's decision, and the
 * log sheet of everything that happened.
 */
export default function LabourAttendanceDeleteRequestsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { canApprove, isSuperAdmin } = useAttendanceDeleteAccess();

  const [rejectTarget, setRejectTarget] = useState<AttendanceDeleteRequest | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [approveTarget, setApproveTarget] = useState<AttendanceDeleteRequest | null>(null);
  const [approveNotes, setApproveNotes] = useState("");
  const [cancelTarget, setCancelTarget] = useState<AttendanceDeleteRequest | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // History filters
  const [hStatus, setHStatus] = useState<string>("all");
  const [hRequester, setHRequester] = useState<string>("all");
  const [hSearch, setHSearch] = useState("");
  const [hFrom, setHFrom] = useState("");
  const [hTo, setHTo] = useState("");

  // Log sheet filters
  const [lEvent, setLEvent] = useState<string>("all");
  const [lSearch, setLSearch] = useState("");
  const [lFrom, setLFrom] = useState("");
  const [lTo, setLTo] = useState("");

  const { data: requests = [], isLoading } = useQuery({
    queryKey: [REQUESTS_KEY],
    queryFn: async () => {
      const { data, error } = await ladDb
        .from("labour_attendance_delete_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data || []) as AttendanceDeleteRequest[];
    },
  });

  const { data: log = [], isLoading: logLoading } = useQuery({
    queryKey: [LOG_KEY],
    queryFn: async () => {
      const { data, error } = await ladDb
        .from("labour_attendance_delete_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10000);
      if (error) throw error;
      return (data || []) as AttendanceDeleteLogRow[];
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [REQUESTS_KEY] });
    queryClient.invalidateQueries({ queryKey: [LOG_KEY] });
    queryClient.invalidateQueries({ queryKey: [PENDING_MAP_KEY] });
    queryClient.invalidateQueries({ queryKey: ["labour-productivity-entries"] });
    queryClient.invalidateQueries({ queryKey: ["labour-attendance"] });
  };

  const approveMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => reviewAttendanceDeleteRequest(id, true, notes),
    onSuccess: () => {
      refresh();
      toast.success("Request approved — attendance entry deleted");
      setApproveTarget(null);
      setApproveNotes("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => reviewAttendanceDeleteRequest(id, false, notes),
    onSuccess: () => {
      refresh();
      toast.success("Request rejected");
      setRejectTarget(null);
      setRejectNotes("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => cancelAttendanceDeleteRequest(id, reason),
    onSuccess: () => {
      refresh();
      toast.success("Request cancelled");
      setCancelTarget(null);
      setCancelReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = useMemo(() => requests.filter((r) => r.status === "pending"), [requests]);
  const history = useMemo(() => requests.filter((r) => r.status !== "pending"), [requests]);

  const historyRequesters = useMemo(() => {
    const map = new Map<string, string>();
    history.forEach((r) => {
      if (r.requested_by) map.set(r.requested_by, r.requested_by_name || "-");
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [history]);

  const filteredHistory = useMemo(
    () =>
      history.filter((r) => {
        if (hStatus !== "all" && r.status !== hStatus) return false;
        if (hRequester !== "all" && r.requested_by !== hRequester) return false;
        if (hFrom && r.target_date < hFrom) return false;
        if (hTo && r.target_date > hTo) return false;
        return matchesSearch(hSearch, r.request_number, r.employee_code, r.employee_name, r.department_name, r.process_name, r.reason);
      }),
    [history, hStatus, hRequester, hFrom, hTo, hSearch],
  );

  const filteredLog = useMemo(
    () =>
      log.filter((l) => {
        if (lEvent !== "all" && l.event !== lEvent) return false;
        const day = l.created_at.slice(0, 10);
        if (lFrom && day < lFrom) return false;
        if (lTo && day > lTo) return false;
        return matchesSearch(lSearch, l.request_number, l.employee_code, l.employee_name, l.department_name, l.acted_by_name, l.reason, l.notes);
      }),
    [log, lEvent, lFrom, lTo, lSearch],
  );

  const exportLog = () => {
    if (filteredLog.length === 0) {
      toast.error("Nothing to export for the selected filters");
      return;
    }
    const rows = filteredLog.map((l) => ({
      "Logged At": fmtStamp(l.created_at),
      "Request No": l.request_number,
      Event: EVENT_LABEL[l.event] || l.event,
      "Worker Code": l.employee_code || "",
      Worker: l.employee_name || "",
      "Attendance Date": fmtDate(l.target_date),
      Department: l.department_name || "",
      Process: l.process_name || "",
      Attendance: workTypeLabel(l.work_type),
      "Check In": formatClock(l.check_in),
      "Check Out": formatClock(l.check_out),
      Reason: l.reason || "",
      Notes: l.notes || "",
      "Done By": l.acted_by_name || "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Attendance Delete Log");
    XLSX.writeFile(wb, `attendance-delete-log-${format(new Date(), "yyyyMMdd_HHmm")}.xlsx`);
  };

  const exportHistory = () => {
    if (filteredHistory.length === 0) {
      toast.error("Nothing to export for the selected filters");
      return;
    }
    const rows = filteredHistory.map((r) => ({
      "Request No": r.request_number,
      Status: STATUS_LABEL[r.status],
      "Worker Code": r.employee_code || "",
      Worker: r.employee_name || "",
      "Attendance Date": fmtDate(r.target_date),
      Department: r.department_name || "",
      Process: r.process_name || "",
      Attendance: workTypeLabel(r.work_type),
      MPH: r.mph ?? "",
      "Check In": formatClock(r.check_in),
      "Check Out": formatClock(r.check_out),
      "Marked By": r.entry_created_by_name || "",
      Reason: r.reason,
      "Requested By": r.requested_by_name || "",
      "Requested At": fmtStamp(r.created_at),
      "Reviewed By": r.reviewed_by_name || "",
      "Reviewed At": fmtStamp(r.reviewed_at),
      "Review Notes": r.review_notes || "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Attendance Delete Requests");
    XLSX.writeFile(wb, `attendance-delete-requests-${format(new Date(), "yyyyMMdd_HHmm")}.xlsx`);
  };

  const renderEntryCell = (r: AttendanceDeleteRequest) => (
    <div className="text-xs leading-tight space-y-0.5">
      <div>{workTypeLabel(r.work_type)}{r.mph != null && <span className="text-muted-foreground"> · MPH {r.mph}</span>}</div>
      {(r.check_in || r.check_out) && (
        <div className="text-muted-foreground">{formatClock(r.check_in) || "--:--"} → {formatClock(r.check_out) || "--:--"}</div>
      )}
      <div className="text-muted-foreground">
        {r.entry_status === "approved" ? "Approved entry" : "Draft entry"}
        {r.entry_created_by_name && <> · marked by {r.entry_created_by_name}</>}
      </div>
    </div>
  );

  const renderStatusCell = (r: AttendanceDeleteRequest) => (
    <div>
      <Badge className={STATUS_CLASS[r.status as AttendanceDeleteStatus]}>{STATUS_LABEL[r.status as AttendanceDeleteStatus] || r.status}</Badge>
      {r.reviewed_by_name && (
        <p className="text-xs text-muted-foreground mt-1">
          by {r.reviewed_by_name}{r.reviewed_at && ` · ${fmtStamp(r.reviewed_at)}`}
        </p>
      )}
      {r.review_notes && <p className="text-xs text-muted-foreground mt-1 italic">"{r.review_notes}"</p>}
    </div>
  );

  const renderRequests = (items: AttendanceDeleteRequest[], showActions: boolean) => (
    <div className="border rounded-lg overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Request</TableHead>
            <TableHead>Worker</TableHead>
            <TableHead>Attendance Date</TableHead>
            <TableHead>Department / Process</TableHead>
            <TableHead>Entry</TableHead>
            <TableHead className="min-w-[220px]">Reason</TableHead>
            <TableHead>Requested By</TableHead>
            {showActions ? <TableHead>Actions</TableHead> : <TableHead>Status / Reviewer</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                No requests found
              </TableCell>
            </TableRow>
          ) : (
            items.map((r) => {
              const isMine = !!user?.id && r.requested_by === user.id;
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.request_number}</TableCell>
                  <TableCell>
                    {r.employee_name || "-"}
                    {r.employee_code && <span className="text-xs text-muted-foreground ml-1">({r.employee_code})</span>}
                  </TableCell>
                  <TableCell>{fmtDate(r.target_date)}</TableCell>
                  <TableCell className="text-xs">
                    <div>{r.department_name || "-"}</div>
                    <div className="text-muted-foreground">{r.process_name || "-"}</div>
                  </TableCell>
                  <TableCell>{renderEntryCell(r)}</TableCell>
                  <TableCell className="max-w-[320px] whitespace-pre-wrap text-xs">{r.reason}</TableCell>
                  <TableCell className="text-xs">
                    <div>{r.requested_by_name || "-"}</div>
                    <div className="text-muted-foreground">{fmtStamp(r.created_at)}</div>
                  </TableCell>
                  {showActions ? (
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {canApprove && (
                          <>
                            <Button size="sm" onClick={() => { setApproveTarget(r); setApproveNotes(""); }} disabled={approveMutation.isPending}>
                              <Check className="h-4 w-4 mr-1" /> Approve
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => { setRejectTarget(r); setRejectNotes(""); }}>
                              <X className="h-4 w-4 mr-1" /> Reject
                            </Button>
                          </>
                        )}
                        {(isMine || canApprove) && (
                          <Button size="sm" variant="outline" onClick={() => { setCancelTarget(r); setCancelReason(""); }} title="Withdraw this request">
                            <Undo2 className="h-4 w-4 mr-1" /> Cancel
                          </Button>
                        )}
                        {!canApprove && !isMine && <span className="text-xs text-muted-foreground">Waiting for approver</span>}
                      </div>
                    </TableCell>
                  ) : (
                    <TableCell>{renderStatusCell(r)}</TableCell>
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
          title="Attendance Delete Requests"
          description="A supervisor's request to delete a worker's attendance marked by mistake, the approver's decision, and the log sheet"
        />

        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">
              Pending {pending.length > 0 && <Badge className="ml-2 bg-amber-500">{pending.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="log">Log Sheet</TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="mt-4 space-y-3">
            {!canApprove && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                Requests are approved by the <strong>Labour Attendance Delete Approver</strong>{isSuperAdmin ? "" : " (or a super admin)"}.
                You can withdraw a request you raised while it is still pending.
              </div>
            )}
            {isLoading ? <div className="text-center py-8 text-muted-foreground">Loading…</div> : renderRequests(pending, true)}
          </TabsContent>

          <TabsContent value="history" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3 p-3 border rounded-lg bg-muted/30">
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={hStatus} onValueChange={setHStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Requester</Label>
                <Select value={hRequester} onValueChange={setHRequester}>
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
                <Label className="text-xs">From (attendance date)</Label>
                <Input type="date" value={hFrom} onChange={(e) => setHFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">To (attendance date)</Label>
                <Input type="date" value={hTo} onChange={(e) => setHTo(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Search (request no, worker, department, reason)</Label>
                <div className="flex gap-2">
                  <Input value={hSearch} onChange={(e) => setHSearch(e.target.value)} placeholder="Search…" />
                  <Button variant="outline" onClick={exportHistory} title="Export to Excel">
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
            {isLoading ? <div className="text-center py-8 text-muted-foreground">Loading…</div> : renderRequests(filteredHistory, false)}
          </TabsContent>

          <TabsContent value="log" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3 p-3 border rounded-lg bg-muted/30">
              <div>
                <Label className="text-xs">Event</Label>
                <Select value={lEvent} onValueChange={setLEvent}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {(Object.keys(EVENT_LABEL) as Array<keyof typeof EVENT_LABEL>).map((k) => (
                      <SelectItem key={k} value={k}>{EVENT_LABEL[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">From (logged date)</Label>
                <Input type="date" value={lFrom} onChange={(e) => setLFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">To (logged date)</Label>
                <Input type="date" value={lTo} onChange={(e) => setLTo(e.target.value)} />
              </div>
              <div className="md:col-span-3">
                <Label className="text-xs">Search (request no, worker, department, done by, reason, notes)</Label>
                <div className="flex gap-2">
                  <Input value={lSearch} onChange={(e) => setLSearch(e.target.value)} placeholder="Search…" />
                  <Button variant="outline" onClick={exportLog} title="Export log sheet to Excel">
                    <Download className="h-4 w-4 mr-1" /> Excel
                  </Button>
                </div>
              </div>
            </div>

            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Logged At</TableHead>
                    <TableHead>Request</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Worker</TableHead>
                    <TableHead>Attendance Date</TableHead>
                    <TableHead>Department / Process</TableHead>
                    <TableHead>Attendance</TableHead>
                    <TableHead className="min-w-[220px]">Reason</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Done By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logLoading ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Loading…</TableCell>
                    </TableRow>
                  ) : filteredLog.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No log entries found</TableCell>
                    </TableRow>
                  ) : (
                    filteredLog.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs whitespace-nowrap">{fmtStamp(l.created_at)}</TableCell>
                        <TableCell className="font-mono text-xs">{l.request_number}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={EVENT_CLASS[l.event] || ""}>{EVENT_LABEL[l.event] || l.event}</Badge>
                        </TableCell>
                        <TableCell>
                          {l.employee_name || "-"}
                          {l.employee_code && <span className="text-xs text-muted-foreground ml-1">({l.employee_code})</span>}
                        </TableCell>
                        <TableCell>{fmtDate(l.target_date)}</TableCell>
                        <TableCell className="text-xs">
                          <div>{l.department_name || "-"}</div>
                          <div className="text-muted-foreground">{l.process_name || "-"}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div>{workTypeLabel(l.work_type)}</div>
                          {(l.check_in || l.check_out) && (
                            <div className="text-muted-foreground">{formatClock(l.check_in) || "--:--"} → {formatClock(l.check_out) || "--:--"}</div>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[300px] whitespace-pre-wrap text-xs">{l.reason || "-"}</TableCell>
                        <TableCell className="max-w-[240px] whitespace-pre-wrap text-xs">{l.notes || "-"}</TableCell>
                        <TableCell className="text-xs">{l.acted_by_name || "-"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Approve */}
      <Dialog open={!!approveTarget} onOpenChange={(open) => { if (!open) { setApproveTarget(null); setApproveNotes(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Delete Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
              Approving <strong>{approveTarget?.request_number}</strong> deletes the attendance entry of{" "}
              <strong>{approveTarget?.employee_name}</strong>
              {approveTarget?.employee_code && ` (${approveTarget.employee_code})`} for{" "}
              <strong>{fmtDate(approveTarget?.target_date)}</strong>. This cannot be undone; the entry would have to be marked again.
            </div>
            <div className="rounded border bg-muted/40 p-3 text-xs">
              <p className="font-semibold">Supervisor's reason</p>
              <p className="whitespace-pre-wrap">{approveTarget?.reason}</p>
            </div>
            <div className="space-y-2">
              <Label>Approval notes (optional)</Label>
              <Textarea value={approveNotes} onChange={(e) => setApproveNotes(e.target.value)} rows={2} placeholder="Any remark for the log sheet…" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setApproveTarget(null); setApproveNotes(""); }}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => approveTarget && approveMutation.mutate({ id: approveTarget.id, notes: approveNotes })}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending ? "Deleting…" : "Approve & Delete Attendance"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reject */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectNotes(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Delete Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {rejectTarget?.request_number} · {rejectTarget?.employee_name} · {fmtDate(rejectTarget?.target_date)}. The attendance entry stays as it is.
            </p>
            <div className="space-y-2">
              <Label>Reason for rejection <span className="text-destructive">*</span></Label>
              <Textarea value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} rows={3} placeholder="Tell the supervisor why the request is refused (required)" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectNotes(""); }}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (!rejectTarget) return;
                  if (!rejectNotes.trim()) {
                    toast.error("Give a reason for rejecting the request");
                    return;
                  }
                  rejectMutation.mutate({ id: rejectTarget.id, notes: rejectNotes });
                }}
                disabled={rejectMutation.isPending}
              >
                Reject
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel (withdraw) */}
      <Dialog open={!!cancelTarget} onOpenChange={(open) => { if (!open) { setCancelTarget(null); setCancelReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw Delete Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {cancelTarget?.request_number} · {cancelTarget?.employee_name} · {fmtDate(cancelTarget?.target_date)}. The attendance entry stays as it is.
            </p>
            <div className="space-y-2">
              <Label>Why is it withdrawn? (optional)</Label>
              <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={2} placeholder="e.g. Raised on the wrong worker" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setCancelTarget(null); setCancelReason(""); }}>Keep Request</Button>
              <Button
                onClick={() => cancelTarget && cancelMutation.mutate({ id: cancelTarget.id, reason: cancelReason })}
                disabled={cancelMutation.isPending}
              >
                Withdraw
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
