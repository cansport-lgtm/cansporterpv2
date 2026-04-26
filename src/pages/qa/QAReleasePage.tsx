import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { CheckCircle2, XCircle, Eye, Search, Calendar } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

export default function QAReleasePage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showActionDialog, setShowActionDialog] = useState(false);
  const [selectedInspection, setSelectedInspection] = useState<any>(null);
  const [actionType, setActionType] = useState<"approve" | "reject">("approve");
  const [remarks, setRemarks] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // Fetch inspections pending approval (excluding operator-created inspections)
  const { data: inspections = [] } = useQuery({
    queryKey: ["qa-inspections-pending", dateFilter],
    queryFn: async () => {
      // First get all operator user IDs
      const { data: operatorRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "operator");
      
      const operatorIds = operatorRoles?.map(r => r.user_id) || [];

      let query = supabase
        .from("qa_inspections")
        .select(`
          *,
          qa_processes(name, code),
          production_departments(name),
          grades(name),
          inspector:app_users!qa_inspections_inspector_id_fkey(full_name),
          reviewer:app_users!qa_inspections_reviewed_by_fkey(full_name)
        `)
        .in("status", ["draft", "pending_approval", "in_progress"])
        .order("created_at", { ascending: false });
      
      if (dateFilter) {
        query = query.eq("inspection_date", dateFilter);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      
      // Filter out inspections created by operators
      return data?.filter(insp => !operatorIds.includes(insp.created_by)) || [];
    },
  });

  // Fetch readings for selected inspection
  const { data: readings = [] } = useQuery({
    queryKey: ["qa-inspection-readings", selectedInspection?.id],
    queryFn: async () => {
      if (!selectedInspection?.id) return [];
      const { data, error } = await supabase
        .from("qa_inspection_readings")
        .select("*, qa_process_parameters(parameter_name, parameter_type, unit, min_value, max_value)")
        .eq("inspection_id", selectedInspection.id);
      if (error) throw error;
      return data;
    },
    enabled: !!selectedInspection?.id,
  });

  // Approve/Reject mutation
  const actionMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updateData: any = {
        status,
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
      };
      
      if (remarks) {
        updateData.remarks = remarks;
      }
      
      const { error } = await supabase
        .from("qa_inspections")
        .update(updateData)
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-inspections-pending"] });
      toast.success(actionType === "approve" ? "Inspection approved!" : "Inspection rejected!");
      setShowActionDialog(false);
      setRemarks("");
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  const handleAction = (inspection: any, type: "approve" | "reject") => {
    setSelectedInspection(inspection);
    setActionType(type);
    setRemarks("");
    setShowActionDialog(true);
  };

  const confirmAction = () => {
    if (!selectedInspection) return;
    actionMutation.mutate({
      id: selectedInspection.id,
      status: actionType === "approve" ? "approved" : "rejected",
    });
  };

  const handleView = (inspection: any) => {
    setSelectedInspection(inspection);
    setShowViewDialog(true);
  };

  const filteredInspections = inspections.filter((insp: any) =>
    insp.inspection_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    insp.qa_processes?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns = [
    { key: "inspection_number", header: "Inspection #" },
    {
      key: "qa_processes.name",
      header: "Process",
      render: (row: any) => row.qa_processes?.name || "-",
    },
    {
      key: "production_departments.name",
      header: "Department",
      render: (row: any) => row.production_departments?.name || "-",
    },
    { key: "inspection_date", header: "Date" },
    {
      key: "result",
      header: "Result",
      render: (row: any) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
          row.result === "pass" ? "bg-green-100 text-green-700" :
          row.result === "fail" ? "bg-red-100 text-red-700" :
          "bg-yellow-100 text-yellow-700"
        }`}>
          {row.result?.toUpperCase()}
        </span>
      ),
    },
    {
      key: "inspector.full_name",
      header: "Inspector",
      render: (row: any) => row.inspector?.full_name || "-",
    },
    {
      key: "status",
      header: "Status",
      render: (row: any) => <StatusBadge status={row.status} />,
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: any) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => handleView(row)}>
            <Eye className="h-4 w-4" />
          </Button>
          {row.status !== "approved" && row.status !== "rejected" && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="text-green-600 hover:text-green-700"
                onClick={() => handleAction(row, "approve")}
              >
                <CheckCircle2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-red-600 hover:text-red-700"
                onClick={() => handleAction(row, "reject")}
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="QA Release"
          description="Review and approve/reject quality inspections"
        />

        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-40"
              placeholder="Filter by date"
            />
          </div>
          <div className="flex items-center gap-2 flex-1 max-w-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search inspections..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          {dateFilter && (
            <Button variant="outline" size="sm" onClick={() => setDateFilter("")}>
              Clear Date
            </Button>
          )}
        </div>

        <DataTable
          columns={columns}
          data={filteredInspections}
          emptyMessage="No inspections pending review."
        />

        {/* View Dialog */}
        <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Inspection Details - {selectedInspection?.inspection_number}</DialogTitle>
            </DialogHeader>
            {selectedInspection && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Process</p>
                    <p className="font-medium">{selectedInspection.qa_processes?.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Department</p>
                    <p className="font-medium">{selectedInspection.production_departments?.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Date</p>
                    <p className="font-medium">{selectedInspection.inspection_date}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Result</p>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      selectedInspection.result === "pass" ? "bg-green-100 text-green-700" :
                      selectedInspection.result === "fail" ? "bg-red-100 text-red-700" :
                      "bg-yellow-100 text-yellow-700"
                    }`}>
                      {selectedInspection.result?.toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Inspector</p>
                    <p className="font-medium">{selectedInspection.inspector?.full_name || "-"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <StatusBadge status={selectedInspection.status} />
                  </div>
                  {(selectedInspection as any).tag_tracking_number && (
                    <div>
                      <p className="text-muted-foreground">Tracking Number</p>
                      <p className="font-mono font-medium">{(selectedInspection as any).tag_tracking_number}</p>
                    </div>
                  )}
                </div>

                {readings.length > 0 && (
                  <div className="space-y-2">
                    <p className="font-semibold">Parameter Readings</p>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {readings.map((reading: any) => (
                        <div key={reading.id} className="flex justify-between items-center p-2 bg-muted/50 rounded">
                          <div>
                            <span className="font-medium">{reading.qa_process_parameters?.parameter_name}</span>
                            {reading.qa_process_parameters?.unit && (
                              <span className="text-muted-foreground text-sm ml-1">
                                ({reading.qa_process_parameters.unit})
                              </span>
                            )}
                          </div>
                          <span className={`font-medium ${!reading.is_within_spec ? "text-destructive" : ""}`}>
                            {reading.qa_process_parameters?.parameter_type === "number" ? reading.value_number :
                             reading.qa_process_parameters?.parameter_type === "boolean" ? (reading.value_boolean ? "Yes" : "No") :
                             reading.value_text || "-"}
                            {!reading.is_within_spec && " ⚠️"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedInspection.remarks && (
                  <div>
                    <p className="text-muted-foreground text-sm">Remarks</p>
                    <p>{selectedInspection.remarks}</p>
                  </div>
                )}

                {selectedInspection.reviewed_by && (
                  <div className="border-t pt-4">
                    <p className="text-sm text-muted-foreground">
                      Reviewed by: {selectedInspection.reviewer?.full_name || "Unknown"} on{" "}
                      {selectedInspection.reviewed_at ? format(new Date(selectedInspection.reviewed_at), "PPp") : "-"}
                    </p>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Action Confirmation Dialog */}
        <Dialog open={showActionDialog} onOpenChange={setShowActionDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {actionType === "approve" ? "Approve Inspection" : "Reject Inspection"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p>
                Are you sure you want to {actionType} inspection{" "}
                <span className="font-semibold">{selectedInspection?.inspection_number}</span>?
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium">Remarks (optional)</label>
                <Textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Add any comments..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowActionDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={confirmAction}
                disabled={actionMutation.isPending}
                variant={actionType === "approve" ? "default" : "destructive"}
              >
                {actionMutation.isPending ? "Processing..." : actionType === "approve" ? "Approve" : "Reject"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
