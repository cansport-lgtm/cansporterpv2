import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowLeft, Check, X, ChevronRight, Printer } from "lucide-react";

const STAGE_LABELS: Record<string, string> = {
  idea: "Idea", feasibility: "Feasibility", development: "Development",
  testing: "Testing", validation: "Validation", launch: "Launch",
};
const STAGE_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-500 text-white",
  approved: "bg-green-500 text-white",
  rejected: "bg-destructive text-destructive-foreground",
};

export default function RDProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole('super_admin');
  const [project, setProject] = useState<any>(null);
  const [gates, setGates] = useState<any[]>([]);
  const [experiments, setExperiments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [approveDialog, setApproveDialog] = useState<{ gate: any; action: "approve" | "reject" } | null>(null);
  const [gateRemarks, setGateRemarks] = useState("");

  useEffect(() => { if (id) loadData(); }, [id]);

  const loadData = async () => {
    const [projRes, gatesRes, expRes] = await Promise.all([
      supabase.from("rd_projects").select("*, project_lead:app_users!rd_projects_project_lead_id_fkey(full_name), department:production_departments!rd_projects_department_id_fkey(name)").eq("id", id!).single(),
      supabase.from("rd_stage_gates").select("*, approver:app_users!rd_stage_gates_approved_by_fkey(full_name)").eq("project_id", id!).order("stage_order"),
      supabase.from("rd_experiments").select("*").eq("project_id", id!).order("created_at", { ascending: false }),
    ]);
    setProject(projRes.data);
    setGates(gatesRes.data || []);
    setExperiments(expRes.data || []);
    setLoading(false);
  };

  const handleGateAction = async () => {
    if (!approveDialog || !user) return;
    const { gate, action } = approveDialog;
    const isApprove = action === "approve";

    await supabase.from("rd_stage_gates").update({
      status: isApprove ? "approved" : "rejected",
      completed_at: new Date().toISOString(),
      approved_by: user.id,
      remarks: gateRemarks || null,
    }).eq("id", gate.id);

    if (isApprove) {
      const nextGate = gates.find((g) => g.stage_order === gate.stage_order + 1);
      if (nextGate) {
        await supabase.from("rd_stage_gates").update({ status: "in_progress", started_at: new Date().toISOString() }).eq("id", nextGate.id);
        await supabase.from("rd_projects").update({ current_stage: nextGate.stage_name }).eq("id", id!);
      } else {
        await supabase.from("rd_projects").update({ current_stage: "launch", status: "completed", actual_launch_date: new Date().toISOString().split("T")[0] }).eq("id", id!);
      }
    }

    toast.success(`Gate ${isApprove ? "approved" : "rejected"}`);
    setApproveDialog(null);
    setGateRemarks("");
    loadData();
  };

  if (loading) return <ERPLayout><div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div></ERPLayout>;
  if (!project) return <ERPLayout><div className="text-center py-8">Project not found</div></ERPLayout>;

  return (
    <ERPLayout>
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/rd/projects")}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
      </div>

      <PageHeader title={project.title} description={`${project.project_number} • ${project.project_lead?.full_name || "No lead"}`}>
        <div className="flex gap-2">
          {isSuperAdmin && (
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" /> Print</Button>
          )}
          <Badge variant="outline" className="text-sm">{STAGE_LABELS[project.current_stage]}</Badge>
          <Badge variant={project.status === "active" ? "default" : "secondary"}>{project.status}</Badge>
        </div>
      </PageHeader>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Stage-Gate Timeline</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {gates.map((gate, i) => (
              <div key={gate.id} className="flex items-center">
                <div className={`px-3 py-2 rounded-lg text-xs font-medium min-w-[100px] text-center ${STAGE_COLORS[gate.status]}`}>
                  <div>{STAGE_LABELS[gate.stage_name]}</div>
                  <div className="text-[10px] mt-0.5 opacity-80">{gate.status}</div>
                </div>
                {i < gates.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground mx-1 flex-shrink-0" />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="gates">
        <TabsList>
          <TabsTrigger value="gates">Gate Details</TabsTrigger>
          <TabsTrigger value="experiments">Experiments ({experiments.length})</TabsTrigger>
          <TabsTrigger value="info">Project Info</TabsTrigger>
        </TabsList>

        <TabsContent value="gates">
          <div className="space-y-3">
            {gates.map((gate) => (
              <Card key={gate.id}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{STAGE_LABELS[gate.stage_name]} (Gate {gate.stage_order})</p>
                      <p className="text-xs text-muted-foreground">
                        {gate.started_at ? `Started: ${new Date(gate.started_at).toLocaleDateString()}` : "Not started"}
                        {gate.completed_at && ` • Completed: ${new Date(gate.completed_at).toLocaleDateString()}`}
                        {gate.approver && ` • By: ${gate.approver.full_name}`}
                      </p>
                      {gate.remarks && <p className="text-xs text-muted-foreground mt-1">Remarks: {gate.remarks}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{gate.status}</Badge>
                      {gate.status === "in_progress" && (
                        <>
                          <Button size="sm" variant="default" onClick={() => setApproveDialog({ gate, action: "approve" })}>
                            <Check className="h-3 w-3 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => setApproveDialog({ gate, action: "reject" })}>
                            <X className="h-3 w-3 mr-1" /> Reject
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="experiments">
          {experiments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No experiments linked to this project</p>
          ) : (
            <div className="space-y-2">
              {experiments.map((exp) => (
                <Card key={exp.id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{exp.title}</p>
                        <p className="text-xs text-muted-foreground">{exp.experiment_number} • {exp.experiment_date}</p>
                      </div>
                      <Badge variant="outline">{exp.status}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="info">
          <Card>
            <CardContent className="py-4 space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div><span className="text-muted-foreground">Category:</span> {project.category || "-"}</div>
                <div><span className="text-muted-foreground">Product Type:</span> {project.product_type || "-"}</div>
                <div><span className="text-muted-foreground">Priority:</span> {project.priority}</div>
                <div><span className="text-muted-foreground">Department:</span> {project.department?.name || "-"}</div>
                <div><span className="text-muted-foreground">Target Launch:</span> {project.target_launch_date || "-"}</div>
                <div><span className="text-muted-foreground">Actual Launch:</span> {project.actual_launch_date || "-"}</div>
              </div>
              {project.description && <div className="pt-2"><span className="text-muted-foreground">Description:</span><p className="mt-1">{project.description}</p></div>}
              {project.remarks && <div><span className="text-muted-foreground">Remarks:</span><p className="mt-1">{project.remarks}</p></div>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!approveDialog} onOpenChange={() => { setApproveDialog(null); setGateRemarks(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{approveDialog?.action === "approve" ? "Approve" : "Reject"} Gate: {approveDialog && STAGE_LABELS[approveDialog.gate.stage_name]}</DialogTitle>
          </DialogHeader>
          <Textarea placeholder="Add remarks (optional)" value={gateRemarks} onChange={(e) => setGateRemarks(e.target.value)} />
          <DialogFooter>
            <Button variant={approveDialog?.action === "approve" ? "default" : "destructive"} onClick={handleGateAction}>
              {approveDialog?.action === "approve" ? "Approve Gate" : "Reject Gate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
