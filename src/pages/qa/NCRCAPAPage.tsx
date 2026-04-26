import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Plus, Eye, AlertTriangle, Shield, Edit, Trash2, Printer } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function NCRCAPAPage() {
  const queryClient = useQueryClient();
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const [activeTab, setActiveTab] = useState("ncr");
  const [showNCRDialog, setShowNCRDialog] = useState(false);
  const [showCAPADialog, setShowCAPADialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showEditStatusDialog, setShowEditStatusDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showNCREditStatusDialog, setShowNCREditStatusDialog] = useState(false);
  const [showNCRDeleteDialog, setShowNCRDeleteDialog] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [editingCapaStatus, setEditingCapaStatus] = useState("");
  const [editingNCRStatus, setEditingNCRStatus] = useState("");
  
  const [ncrForm, setNCRForm] = useState({
    department_id: "",
    grade_id: "",
    ncr_date: format(new Date(), "yyyy-MM-dd"),
    description: "",
    root_cause: "",
    immediate_action: "",
    quantity_affected: 0,
    severity: "medium",
  });

  const [capaForm, setCAPAForm] = useState({
    ncr_id: "",
    capa_type: "corrective",
    description: "",
    action_plan: "",
    target_date: "",
    responsible_person: "",
  });

  // Fetch NCRs
  const { data: ncrs = [] } = useQuery({
    queryKey: ["qa-ncrs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_ncr")
        .select(`
          *,
          production_departments(name),
          grades(name),
          raised_by_user:app_users!qa_ncr_raised_by_fkey(full_name),
          assigned_to_user:app_users!qa_ncr_assigned_to_fkey(full_name)
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch CAPAs
  const { data: capas = [] } = useQuery({
    queryKey: ["qa-capas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_capa")
        .select(`
          *,
          qa_ncr(ncr_number, description, severity),
          responsible:app_users!qa_capa_responsible_person_fkey(full_name)
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch departments and grades
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: grades = [] } = useQuery({
    queryKey: ["grades"],
    queryFn: async () => {
      const { data, error } = await supabase.from("grades").select("*").eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ["app-users"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_users").select("id, full_name").eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  // Create NCR mutation
  const createNCRMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("qa_ncr").insert({
        ncr_number: "",
        department_id: ncrForm.department_id,
        grade_id: ncrForm.grade_id || null,
        ncr_date: ncrForm.ncr_date,
        description: ncrForm.description,
        root_cause: ncrForm.root_cause || null,
        immediate_action: ncrForm.immediate_action || null,
        quantity_affected: ncrForm.quantity_affected,
        severity: ncrForm.severity,
        raised_by: user?.id || null,
        status: "draft" as const,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-ncrs"] });
      toast.success("NCR created successfully!");
      setShowNCRDialog(false);
      resetNCRForm();
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  // Create CAPA mutation
  const createCAPAMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("qa_capa").insert({
        capa_number: "",
        ncr_id: capaForm.ncr_id || null,
        capa_type: capaForm.capa_type,
        description: capaForm.description,
        action_plan: capaForm.action_plan || null,
        target_date: capaForm.target_date || null,
        responsible_person: capaForm.responsible_person || null,
        created_by: user?.id || null,
        status: "draft" as const,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-capas"] });
      toast.success("CAPA created successfully!");
      setShowCAPADialog(false);
      resetCAPAForm();
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  // Update CAPA status mutation (super_admin only)
  const updateCAPAStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "draft" | "in_progress" | "pending_approval" | "approved" | "rejected" | "closed" }) => {
      const { error } = await supabase
        .from("qa_capa")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-capas"] });
      toast.success("CAPA status updated successfully!");
      setShowEditStatusDialog(false);
      setSelectedItem(null);
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  // Delete CAPA mutation (super_admin only)
  const deleteCAPAMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("qa_capa").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-capas"] });
      toast.success("CAPA deleted successfully!");
      setShowDeleteDialog(false);
      setShowViewDialog(false);
      setSelectedItem(null);
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  // Update NCR status mutation (super_admin only)
  const updateNCRStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "draft" | "in_progress" | "pending_approval" | "approved" | "rejected" | "closed" }) => {
      const { error } = await supabase
        .from("qa_ncr")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-ncrs"] });
      toast.success("NCR status updated successfully!");
      setShowNCREditStatusDialog(false);
      setSelectedItem(null);
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  // Delete NCR mutation (super_admin only)
  const deleteNCRMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("qa_ncr").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-ncrs"] });
      toast.success("NCR deleted successfully!");
      setShowNCRDeleteDialog(false);
      setShowViewDialog(false);
      setSelectedItem(null);
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  const handlePrintNCR = (item: any) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const severityColor = item.severity === "critical" ? "#dc2626" : item.severity === "high" ? "#ea580c" : item.severity === "medium" ? "#ca8a04" : "#2563eb";
    const relatedCapas = capas.filter((c: any) => c.ncr_id === item.id);
    const capaRows = relatedCapas.map((c: any) => `
      <tr>
        <td style="border:1px solid #ddd;padding:6px;">${c.capa_number}</td>
        <td style="border:1px solid #ddd;padding:6px;">${c.capa_type?.toUpperCase()}</td>
        <td style="border:1px solid #ddd;padding:6px;">${c.description || "-"}</td>
        <td style="border:1px solid #ddd;padding:6px;">${c.target_date || "-"}</td>
        <td style="border:1px solid #ddd;padding:6px;">${c.responsible?.full_name || "-"}</td>
        <td style="border:1px solid #ddd;padding:6px;">${c.status?.toUpperCase()}</td>
      </tr>
    `).join("");

    printWindow.document.write(`
      <html><head><title>NCR - ${item.ncr_number}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 30px; color: #333; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .subtitle { color: #666; font-size: 12px; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
        th { background: #f3f4f6; text-align: left; padding: 8px; border: 1px solid #ddd; font-size: 12px; }
        td { padding: 8px; border: 1px solid #ddd; font-size: 12px; }
        .section { margin-bottom: 16px; }
        .section-title { font-weight: bold; font-size: 13px; margin-bottom: 4px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
        .severity { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; color: white; background: ${severityColor}; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .label { color: #888; font-size: 11px; }
        .value { font-weight: 500; font-size: 13px; }
        @media print { body { padding: 15px; } }
      </style></head><body>
      <h1>Non-Conformance Report</h1>
      <div class="subtitle">NCR #: ${item.ncr_number} | Date: ${item.ncr_date} | Status: ${item.status?.toUpperCase()}</div>
      <div class="grid">
        <div><span class="label">Department</span><div class="value">${item.production_departments?.name || "-"}</div></div>
        <div><span class="label">Severity</span><div><span class="severity">${item.severity?.toUpperCase()}</span></div></div>
        <div><span class="label">Grade</span><div class="value">${item.grades?.name || "-"}</div></div>
        <div><span class="label">Quantity Affected</span><div class="value">${item.quantity_affected || 0}</div></div>
        <div><span class="label">Raised By</span><div class="value">${item.raised_by_user?.full_name || "-"}</div></div>
        <div><span class="label">Assigned To</span><div class="value">${item.assigned_to_user?.full_name || "-"}</div></div>
      </div>
      <div class="section" style="margin-top:16px;">
        <div class="section-title">Description</div>
        <p style="font-size:12px;">${item.description || "-"}</p>
      </div>
      ${item.root_cause ? `<div class="section"><div class="section-title">Root Cause</div><p style="font-size:12px;">${item.root_cause}</p></div>` : ""}
      ${item.immediate_action ? `<div class="section"><div class="section-title">Immediate Action</div><p style="font-size:12px;">${item.immediate_action}</p></div>` : ""}
      ${relatedCapas.length > 0 ? `
        <div class="section">
          <div class="section-title">Related CAPAs</div>
          <table><thead><tr>
            <th>CAPA #</th><th>Type</th><th>Description</th><th>Target Date</th><th>Responsible</th><th>Status</th>
          </tr></thead><tbody>${capaRows}</tbody></table>
        </div>
      ` : ""}
      <div style="margin-top:40px;font-size:11px;color:#aaa;text-align:center;">Printed on ${format(new Date(), "PPp")}</div>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handlePrintCAPA = (item: any) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const ncrSeverityColor = item.qa_ncr?.severity === "critical" ? "#dc2626" : item.qa_ncr?.severity === "high" ? "#ea580c" : item.qa_ncr?.severity === "medium" ? "#ca8a04" : "#2563eb";

    printWindow.document.write(`
      <html><head><title>CAPA - ${item.capa_number}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 30px; color: #333; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .subtitle { color: #666; font-size: 12px; margin-bottom: 20px; }
        .section { margin-bottom: 16px; }
        .section-title { font-weight: bold; font-size: 13px; margin-bottom: 4px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .label { color: #888; font-size: 11px; }
        .value { font-weight: 500; font-size: 13px; }
        .severity { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; color: white; background: ${ncrSeverityColor}; }
        @media print { body { padding: 15px; } }
      </style></head><body>
      <h1>Corrective / Preventive Action Report</h1>
      <div class="subtitle">CAPA #: ${item.capa_number} | Type: ${item.capa_type?.toUpperCase()} | Status: ${item.status?.toUpperCase()}</div>
      <div class="grid">
        <div><span class="label">Type</span><div class="value">${item.capa_type?.toUpperCase()}</div></div>
        <div><span class="label">Target Date</span><div class="value">${item.target_date || "-"}</div></div>
        <div><span class="label">Responsible Person</span><div class="value">${item.responsible?.full_name || "-"}</div></div>
        <div><span class="label">Status</span><div class="value">${item.status?.toUpperCase()}</div></div>
      </div>
      ${item.qa_ncr ? `
        <div class="section" style="margin-top:16px;">
          <div class="section-title">Related NCR</div>
          <div class="grid">
            <div><span class="label">NCR #</span><div class="value">${item.qa_ncr.ncr_number}</div></div>
            <div><span class="label">Severity</span><div><span class="severity">${item.qa_ncr.severity?.toUpperCase()}</span></div></div>
          </div>
          <p style="font-size:12px;margin-top:6px;">${item.qa_ncr.description || ""}</p>
        </div>
      ` : ""}
      <div class="section" style="margin-top:16px;">
        <div class="section-title">Description</div>
        <p style="font-size:12px;">${item.description || "-"}</p>
      </div>
      ${item.action_plan ? `<div class="section"><div class="section-title">Action Plan</div><p style="font-size:12px;">${item.action_plan}</p></div>` : ""}
      <div style="margin-top:40px;font-size:11px;color:#aaa;text-align:center;">Printed on ${format(new Date(), "PPp")}</div>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const resetNCRForm = () => {
    setNCRForm({
      department_id: "",
      grade_id: "",
      ncr_date: format(new Date(), "yyyy-MM-dd"),
      description: "",
      root_cause: "",
      immediate_action: "",
      quantity_affected: 0,
      severity: "medium",
    });
  };

  const resetCAPAForm = () => {
    setCAPAForm({
      ncr_id: "",
      capa_type: "corrective",
      description: "",
      action_plan: "",
      target_date: "",
      responsible_person: "",
    });
  };

  const ncrColumns = [
    { key: "ncr_number", header: "NCR #" },
    {
      key: "production_departments.name",
      header: "Department",
      render: (row: any) => row.production_departments?.name || "-",
    },
    {
      key: "description",
      header: "Description",
      render: (row: any) => (
        <span className="line-clamp-1 max-w-[200px]">{row.description}</span>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      render: (row: any) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
          row.severity === "critical" ? "bg-red-100 text-red-700" :
          row.severity === "high" ? "bg-orange-100 text-orange-700" :
          row.severity === "medium" ? "bg-yellow-100 text-yellow-700" :
          "bg-blue-100 text-blue-700"
        }`}>
          {row.severity?.toUpperCase()}
        </span>
      ),
    },
    { key: "ncr_date", header: "Date" },
    {
      key: "status",
      header: "Status",
      render: (row: any) => <StatusBadge status={row.status} />,
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: any) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => { setSelectedItem(row); setShowViewDialog(true); }}>
            <Eye className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handlePrintNCR(row)} title="Print NCR">
            <Printer className="h-4 w-4" />
          </Button>
          {isSuperAdmin && (
            <>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => { 
                  setSelectedItem(row); 
                  setEditingNCRStatus(row.status);
                  setShowNCREditStatusDialog(true); 
                }}
              >
                <Edit className="h-4 w-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                className="text-destructive hover:text-destructive"
                onClick={() => { setSelectedItem(row); setShowNCRDeleteDialog(true); }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const capaColumns = [
    { key: "capa_number", header: "CAPA #" },
    {
      key: "qa_ncr.ncr_number",
      header: "Related NCR",
      render: (row: any) => row.qa_ncr?.ncr_number || "-",
    },
    {
      key: "qa_ncr.severity",
      header: "NCR Severity",
      render: (row: any) => row.qa_ncr?.severity ? (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
          row.qa_ncr.severity === "critical" ? "bg-red-100 text-red-700" :
          row.qa_ncr.severity === "high" ? "bg-orange-100 text-orange-700" :
          row.qa_ncr.severity === "medium" ? "bg-yellow-100 text-yellow-700" :
          "bg-blue-100 text-blue-700"
        }`}>
          {row.qa_ncr.severity?.toUpperCase()}
        </span>
      ) : "-",
    },
    {
      key: "capa_type",
      header: "Type",
      render: (row: any) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
          row.capa_type === "corrective" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
        }`}>
          {row.capa_type?.toUpperCase()}
        </span>
      ),
    },
    {
      key: "responsible.full_name",
      header: "Responsible Person",
      render: (row: any) => row.responsible?.full_name || "-",
    },
    {
      key: "description",
      header: "Description",
      render: (row: any) => (
        <span className="line-clamp-1 max-w-[200px]">{row.description}</span>
      ),
    },
    { key: "target_date", header: "Target Date" },
    {
      key: "status",
      header: "Status",
      render: (row: any) => <StatusBadge status={row.status} />,
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: any) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => { setSelectedItem(row); setShowViewDialog(true); }}>
            <Eye className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handlePrintCAPA(row)} title="Print CAPA">
            <Printer className="h-4 w-4" />
          </Button>
          {isSuperAdmin && (
            <>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => { 
                  setSelectedItem(row); 
                  setEditingCapaStatus(row.status);
                  setShowEditStatusDialog(true); 
                }}
              >
                <Edit className="h-4 w-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                className="text-destructive hover:text-destructive"
                onClick={() => { setSelectedItem(row); setShowDeleteDialog(true); }}
              >
                <Trash2 className="h-4 w-4" />
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
          title="NCR / CAPA"
          description="Non-Conformance Reports and Corrective/Preventive Actions"
        />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex justify-between items-center">
            <TabsList>
              <TabsTrigger value="ncr" className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                NCR
              </TabsTrigger>
              <TabsTrigger value="capa" className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                CAPA
              </TabsTrigger>
            </TabsList>
            {activeTab === "ncr" ? (
              <Button onClick={() => { resetNCRForm(); setShowNCRDialog(true); }}>
                <Plus className="h-4 w-4 mr-2" />
                New NCR
              </Button>
            ) : (
              <Button onClick={() => { resetCAPAForm(); setShowCAPADialog(true); }}>
                <Plus className="h-4 w-4 mr-2" />
                New CAPA
              </Button>
            )}
          </div>

          <TabsContent value="ncr" className="mt-4">
            <DataTable
              columns={ncrColumns}
              data={ncrs}
              emptyMessage="No NCRs found."
            />
          </TabsContent>

          <TabsContent value="capa" className="mt-4">
            <DataTable
              columns={capaColumns}
              data={capas}
              emptyMessage="No CAPAs found."
            />
          </TabsContent>
        </Tabs>

        {/* NCR Dialog */}
        <Dialog open={showNCRDialog} onOpenChange={setShowNCRDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>New Non-Conformance Report</DialogTitle>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createNCRMutation.mutate(); }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Department *</Label>
                  <Select
                    value={ncrForm.department_id}
                    onValueChange={(v) => setNCRForm({ ...ncrForm, department_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((d: any) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Severity *</Label>
                  <Select
                    value={ncrForm.severity}
                    onValueChange={(v) => setNCRForm({ ...ncrForm, severity: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Grade</Label>
                  <Select
                    value={ncrForm.grade_id}
                    onValueChange={(v) => setNCRForm({ ...ncrForm, grade_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {grades.map((g: any) => (
                        <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Quantity Affected</Label>
                  <Input
                    type="number"
                    value={ncrForm.quantity_affected}
                    onChange={(e) => setNCRForm({ ...ncrForm, quantity_affected: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description *</Label>
                <Textarea
                  value={ncrForm.description}
                  onChange={(e) => setNCRForm({ ...ncrForm, description: e.target.value })}
                  placeholder="Describe the non-conformance..."
                  rows={3}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Root Cause</Label>
                <Textarea
                  value={ncrForm.root_cause}
                  onChange={(e) => setNCRForm({ ...ncrForm, root_cause: e.target.value })}
                  placeholder="Identified root cause..."
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label>Immediate Action</Label>
                <Textarea
                  value={ncrForm.immediate_action}
                  onChange={(e) => setNCRForm({ ...ncrForm, immediate_action: e.target.value })}
                  placeholder="Actions taken immediately..."
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowNCRDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createNCRMutation.isPending}>
                  {createNCRMutation.isPending ? "Saving..." : "Create NCR"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* CAPA Dialog */}
        <Dialog open={showCAPADialog} onOpenChange={setShowCAPADialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>New CAPA</DialogTitle>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createCAPAMutation.mutate(); }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Related NCR</Label>
                  <Select
                    value={capaForm.ncr_id}
                    onValueChange={(v) => setCAPAForm({ ...capaForm, ncr_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select NCR (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {ncrs.filter((n: any) => n.status !== "closed").map((n: any) => (
                        <SelectItem key={n.id} value={n.id}>
                          <div className="flex items-center gap-2">
                            <span>{n.ncr_number}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              n.severity === "critical" ? "bg-red-100 text-red-700" :
                              n.severity === "high" ? "bg-orange-100 text-orange-700" :
                              n.severity === "medium" ? "bg-yellow-100 text-yellow-700" :
                              "bg-blue-100 text-blue-700"
                            }`}>
                              {n.severity?.toUpperCase()}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Type *</Label>
                  <Select
                    value={capaForm.capa_type}
                    onValueChange={(v) => setCAPAForm({ ...capaForm, capa_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="corrective">Corrective</SelectItem>
                      <SelectItem value="preventive">Preventive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description *</Label>
                <Textarea
                  value={capaForm.description}
                  onChange={(e) => setCAPAForm({ ...capaForm, description: e.target.value })}
                  placeholder="Describe the corrective/preventive action..."
                  rows={3}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Action Plan</Label>
                <Textarea
                  value={capaForm.action_plan}
                  onChange={(e) => setCAPAForm({ ...capaForm, action_plan: e.target.value })}
                  placeholder="Steps to implement..."
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Target Date</Label>
                  <Input
                    type="date"
                    value={capaForm.target_date}
                    onChange={(e) => setCAPAForm({ ...capaForm, target_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Responsible Person</Label>
                  <Select
                    value={capaForm.responsible_person}
                    onValueChange={(v) => setCAPAForm({ ...capaForm, responsible_person: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u: any) => (
                        <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowCAPADialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createCAPAMutation.isPending}>
                  {createCAPAMutation.isPending ? "Saving..." : "Create CAPA"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* View Dialog */}
        <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {selectedItem?.ncr_number ? `NCR: ${selectedItem.ncr_number}` : `CAPA: ${selectedItem?.capa_number}`}
              </DialogTitle>
            </DialogHeader>
            {selectedItem && (
              <div className="space-y-4 text-sm">
                {selectedItem.ncr_number ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-muted-foreground">Department</p>
                        <p className="font-medium">{selectedItem.production_departments?.name}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Severity</p>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          selectedItem.severity === "critical" ? "bg-red-100 text-red-700" :
                          selectedItem.severity === "high" ? "bg-orange-100 text-orange-700" :
                          selectedItem.severity === "medium" ? "bg-yellow-100 text-yellow-700" :
                          "bg-blue-100 text-blue-700"
                        }`}>
                          {selectedItem.severity?.toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Date</p>
                        <p className="font-medium">{selectedItem.ncr_date}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Quantity Affected</p>
                        <p className="font-medium">{selectedItem.quantity_affected}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Description</p>
                      <p>{selectedItem.description}</p>
                    </div>
                    {selectedItem.root_cause && (
                      <div>
                        <p className="text-muted-foreground">Root Cause</p>
                        <p>{selectedItem.root_cause}</p>
                      </div>
                    )}
                    {selectedItem.immediate_action && (
                      <div>
                        <p className="text-muted-foreground">Immediate Action</p>
                        <p>{selectedItem.immediate_action}</p>
                      </div>
                    )}
                    {/* Actions for NCR */}
                    <div className="flex gap-2 pt-4 border-t">
                      <Button variant="outline" size="sm" onClick={() => handlePrintNCR(selectedItem)}>
                        <Printer className="h-4 w-4 mr-2" />
                        Print
                      </Button>
                      {isSuperAdmin && (
                        <>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => { 
                            setEditingNCRStatus(selectedItem.status);
                            setShowNCREditStatusDialog(true); 
                          }}
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Edit Status
                        </Button>
                        <Button 
                          variant="destructive" 
                          size="sm"
                          onClick={() => setShowNCRDeleteDialog(true)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </Button>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-muted-foreground">Type</p>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          selectedItem.capa_type === "corrective" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                        }`}>
                          {selectedItem.capa_type?.toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Target Date</p>
                        <p className="font-medium">{selectedItem.target_date || "-"}</p>
                      </div>
                    </div>
                    {selectedItem.qa_ncr && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-muted-foreground">Related NCR</p>
                          <p className="font-medium">{selectedItem.qa_ncr.ncr_number}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">NCR Severity</p>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            selectedItem.qa_ncr.severity === "critical" ? "bg-red-100 text-red-700" :
                            selectedItem.qa_ncr.severity === "high" ? "bg-orange-100 text-orange-700" :
                            selectedItem.qa_ncr.severity === "medium" ? "bg-yellow-100 text-yellow-700" :
                            "bg-blue-100 text-blue-700"
                          }`}>
                            {selectedItem.qa_ncr.severity?.toUpperCase()}
                          </span>
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="text-muted-foreground">Description</p>
                      <p>{selectedItem.description}</p>
                    </div>
                    {selectedItem.action_plan && (
                      <div>
                        <p className="text-muted-foreground">Action Plan</p>
                        <p>{selectedItem.action_plan}</p>
                      </div>
                    )}
                  </>
                )}
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <StatusBadge status={selectedItem.status} />
                </div>
                {/* Actions for CAPA */}
                {selectedItem.capa_number && (
                  <div className="flex gap-2 pt-4 border-t">
                    <Button variant="outline" size="sm" onClick={() => handlePrintCAPA(selectedItem)}>
                      <Printer className="h-4 w-4 mr-2" />
                      Print
                    </Button>
                    {isSuperAdmin && (
                      <>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => { 
                            setEditingCapaStatus(selectedItem.status);
                            setShowEditStatusDialog(true); 
                          }}
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Edit Status
                        </Button>
                        <Button 
                          variant="destructive" 
                          size="sm"
                          onClick={() => setShowDeleteDialog(true)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Edit CAPA Status Dialog (super_admin only) */}
        <Dialog open={showEditStatusDialog} onOpenChange={setShowEditStatusDialog}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Update CAPA Status</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={editingCapaStatus}
                  onValueChange={setEditingCapaStatus}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="pending_approval">Pending Approval</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowEditStatusDialog(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={() => {
                    if (selectedItem) {
                      updateCAPAStatusMutation.mutate({ 
                        id: selectedItem.id, 
                        status: editingCapaStatus as "draft" | "in_progress" | "pending_approval" | "approved" | "rejected" | "closed"
                      });
                    }
                  }}
                  disabled={updateCAPAStatusMutation.isPending}
                >
                  {updateCAPAStatusMutation.isPending ? "Saving..." : "Update Status"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete CAPA Confirmation Dialog (super_admin only) */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete CAPA</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this CAPA ({selectedItem?.capa_number})? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (selectedItem) {
                    deleteCAPAMutation.mutate(selectedItem.id);
                  }
                }}
                disabled={deleteCAPAMutation.isPending}
              >
                {deleteCAPAMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Edit NCR Status Dialog (super_admin only) */}
        <Dialog open={showNCREditStatusDialog} onOpenChange={setShowNCREditStatusDialog}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Update NCR Status</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={editingNCRStatus}
                  onValueChange={setEditingNCRStatus}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="pending_approval">Pending Approval</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowNCREditStatusDialog(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={() => {
                    if (selectedItem) {
                      updateNCRStatusMutation.mutate({ 
                        id: selectedItem.id, 
                        status: editingNCRStatus as "draft" | "in_progress" | "pending_approval" | "approved" | "rejected" | "closed"
                      });
                    }
                  }}
                  disabled={updateNCRStatusMutation.isPending}
                >
                  {updateNCRStatusMutation.isPending ? "Saving..." : "Update Status"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete NCR Confirmation Dialog (super_admin only) */}
        <AlertDialog open={showNCRDeleteDialog} onOpenChange={setShowNCRDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete NCR</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this NCR ({selectedItem?.ncr_number})? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (selectedItem) {
                    deleteNCRMutation.mutate(selectedItem.id);
                  }
                }}
                disabled={deleteNCRMutation.isPending}
              >
                {deleteNCRMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ERPLayout>
  );
}
