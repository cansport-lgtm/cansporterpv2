import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Plus, Play, Eye, CheckCircle, Printer } from "lucide-react";
import { format, parseISO } from "date-fns";

const S_CATEGORIES = ['Sort', 'Set in Order', 'Shine', 'Standardize', 'Sustain'] as const;

export default function FiveSAuditsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showAuditDialog, setShowAuditDialog] = useState(false);
  const [selectedAudit, setSelectedAudit] = useState<any>(null);
  const [newDepartmentId, setNewDepartmentId] = useState("");
  const [newRemarks, setNewRemarks] = useState("");
  const [auditResponses, setAuditResponses] = useState<Record<string, { response: string; remarks: string }>>({});
  const [activeCategory, setActiveCategory] = useState<string>('Sort');

  const { data: departments = [] } = useQuery({
    queryKey: ['five-s-departments'],
    queryFn: async () => {
      const { data } = await supabase.from('five_s_departments').select('id, name').eq('is_active', true).order('name');
      return data || [];
    },
  });

  const { data: audits = [], isLoading } = useQuery({
    queryKey: ['five-s-audits-list'],
    queryFn: async () => {
      const { data } = await supabase.from('five_s_audits').select(`
        *,
        five_s_departments(name),
        app_users!five_s_audits_auditor_id_fkey(full_name)
      `).order('created_at', { ascending: false });
      return data || [];
    },
  });

  const { data: checkpoints = [] } = useQuery({
    queryKey: ['five-s-checkpoints'],
    queryFn: async () => {
      const { data } = await supabase.from('five_s_checkpoints').select('*').eq('is_active', true).order('sort_order');
      return data || [];
    },
  });

  const createAuditMutation = useMutation({
    mutationFn: async () => {
      // Generate audit number
      const count = audits.length + 1;
      const auditNumber = `5S-${format(new Date(), 'yyyyMM')}-${String(count).padStart(4, '0')}`;

      const { data, error } = await supabase.from('five_s_audits').insert({
        audit_number: auditNumber,
        department_id: newDepartmentId,
        auditor_id: user?.id,
        audit_date: format(new Date(), 'yyyy-MM-dd'),
        status: 'draft',
        remarks: newRemarks || null,
      }).select().single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['five-s-audits-list'] });
      setShowNewDialog(false);
      setNewDepartmentId("");
      setNewRemarks("");
      toast.success("Audit created successfully");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const loadAuditResponses = async (auditId: string) => {
    const { data } = await supabase.from('five_s_audit_responses').select('*').eq('audit_id', auditId);
    const map: Record<string, { response: string; remarks: string }> = {};
    (data || []).forEach(r => {
      map[r.checkpoint_id] = { response: r.response, remarks: r.remarks || '' };
    });
    setAuditResponses(map);
  };

  const openAudit = async (audit: any) => {
    setSelectedAudit(audit);
    setActiveCategory('Sort');
    await loadAuditResponses(audit.id);
    setShowAuditDialog(true);
  };

  const saveResponsesMutation = useMutation({
    mutationFn: async ({ auditId, complete }: { auditId: string; complete: boolean }) => {
      // Delete existing responses
      await supabase.from('five_s_audit_responses').delete().eq('audit_id', auditId);

      // Insert new responses
      const responsesToInsert = Object.entries(auditResponses).map(([checkpointId, resp]) => ({
        audit_id: auditId,
        checkpoint_id: checkpointId,
        response: resp.response,
        remarks: resp.remarks || null,
      }));

      if (responsesToInsert.length > 0) {
        const { error } = await supabase.from('five_s_audit_responses').insert(responsesToInsert);
        if (error) throw error;
      }

      // Calculate scores
      const totalCheckpoints = checkpoints.length;
      const answered = Object.values(auditResponses);
      const yesCount = answered.filter(r => r.response === 'yes').length;
      const partialCount = answered.filter(r => r.response === 'partial').length;
      const noCount = answered.filter(r => r.response === 'no').length;
      const score = totalCheckpoints > 0 ? ((yesCount + partialCount * 0.5) / totalCheckpoints * 100) : 0;

      const updateData: any = {
        total_checkpoints: totalCheckpoints,
        compliant_count: yesCount,
        partial_count: partialCount,
        non_compliant_count: noCount,
        overall_score: score,
        status: complete ? 'completed' : 'in_progress',
      };

      const { error: updateError } = await supabase.from('five_s_audits').update(updateData).eq('id', auditId);
      if (updateError) throw updateError;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['five-s-audits-list'] });
      if (vars.complete) {
        setShowAuditDialog(false);
        toast.success("Audit completed successfully!");
      } else {
        toast.success("Responses saved");
      }
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleResponseChange = (checkpointId: string, response: string) => {
    setAuditResponses(prev => ({
      ...prev,
      [checkpointId]: { ...prev[checkpointId], response, remarks: prev[checkpointId]?.remarks || '' },
    }));
  };

  const handleRemarkChange = (checkpointId: string, remarks: string) => {
    setAuditResponses(prev => ({
      ...prev,
      [checkpointId]: { ...prev[checkpointId], remarks, response: prev[checkpointId]?.response || 'not_checked' },
    }));
  };

  const categoryCheckpoints = checkpoints.filter(c => c.category === activeCategory);
  const isViewOnly = selectedAudit?.status === 'completed';

  const handlePrint = async (audit: any) => { // print audit report
    // Load responses for this audit
    const { data: responses } = await supabase.from('five_s_audit_responses').select('*').eq('audit_id', audit.id);
    const respMap: Record<string, { response: string; remarks: string }> = {};
    (responses || []).forEach(r => { respMap[r.checkpoint_id] = { response: r.response, remarks: r.remarks || '' }; });

    const deptName = (audit as any).five_s_departments?.name || '-';
    const auditorName = (audit as any).app_users?.full_name || '-';
    const score = Number(audit.overall_score).toFixed(0);

    const printWindow = window.open('', '_blank');
    if (!printWindow) { toast.error("Please allow popups to print"); return; }

    let checkpointsHtml = '';
    for (const cat of S_CATEGORIES) {
      const catCps = checkpoints.filter(c => c.category === cat);
      if (catCps.length === 0) continue;
      checkpointsHtml += `<tr style="background:#f0f0f0;"><td colspan="5" style="padding:8px;font-weight:bold;font-size:14px;">${cat}</td></tr>`;
      catCps.forEach((cp, i) => {
        const r = respMap[cp.id];
        const respText = r?.response === 'yes' ? '✅ Yes' : r?.response === 'partial' ? '⚠️ Partial' : r?.response === 'no' ? '❌ No' : '-';
        const urdu = (cp as any).checkpoint_text_urdu || '';
        checkpointsHtml += `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e0e0e0;">${i + 1}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e0e0e0;">${cp.checkpoint_text}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e0e0e0;text-align:right;direction:rtl;">${urdu}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e0e0e0;text-align:center;">${respText}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e0e0e0;">${r?.remarks || '-'}</td>
        </tr>`;
      });
    }

    printWindow.document.write(`<!DOCTYPE html><html><head><title>5S Audit Report - ${audit.audit_number}</title>
      <style>body{font-family:Arial,sans-serif;margin:20px;color:#333}table{width:100%;border-collapse:collapse;margin-top:16px}th{background:#1a1a2e;color:#fff;padding:8px;text-align:left;font-size:13px}td{font-size:12px}
      .header{text-align:center;margin-bottom:20px}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;font-size:13px}.info-grid span{font-weight:bold}
      .score-box{text-align:center;font-size:28px;font-weight:bold;padding:12px;border:2px solid #1a1a2e;border-radius:8px;margin:12px 0;display:inline-block}
      @media print{body{margin:10px}}</style></head><body>
      <div class="header">
        <h2 style="margin:0">CANSPORT</h2>
        <h3 style="margin:4px 0">5S Audit Report</h3>
      </div>
      <div class="info-grid">
        <div><span>Audit #:</span> ${audit.audit_number}</div>
        <div><span>Date:</span> ${format(parseISO(audit.audit_date), 'dd MMM yyyy')}</div>
        <div><span>Department:</span> ${deptName}</div>
        <div><span>Auditor:</span> ${auditorName}</div>
        <div><span>Status:</span> ${audit.status}</div>
        <div><span>Score:</span> <span class="score-box">${score}%</span></div>
      </div>
      <div style="margin-bottom:8px;font-size:13px;"><strong>Compliant:</strong> ${audit.compliant_count || 0} | <strong>Partial:</strong> ${audit.partial_count || 0} | <strong>Non-Compliant:</strong> ${audit.non_compliant_count || 0} | <strong>Total:</strong> ${audit.total_checkpoints || 0}</div>
      <table><thead><tr><th>#</th><th>Checkpoint</th><th style="text-align:right">اردو</th><th style="text-align:center">Response</th><th>Remarks</th></tr></thead><tbody>${checkpointsHtml}</tbody></table>
      ${audit.remarks ? `<p style="margin-top:16px;font-size:13px;"><strong>Audit Remarks:</strong> ${audit.remarks}</p>` : ''}
      <p style="margin-top:30px;font-size:11px;color:#888;text-align:center;">Printed on ${format(new Date(), 'dd MMM yyyy HH:mm')}</p>
      </body></html>`);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <PageHeader title="5S Audits" description="Conduct and manage 5S audits" />
          <Button onClick={() => setShowNewDialog(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Audit
          </Button>
        </div>

        {/* Audits Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Audit #</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Auditor</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audits.map(audit => (
                  <TableRow key={audit.id}>
                    <TableCell className="font-medium">{audit.audit_number}</TableCell>
                    <TableCell>{(audit as any).five_s_departments?.name || '-'}</TableCell>
                    <TableCell>{(audit as any).app_users?.full_name || '-'}</TableCell>
                    <TableCell>{format(parseISO(audit.audit_date), 'dd MMM yyyy')}</TableCell>
                    <TableCell>
                      <Badge variant={audit.status === 'completed' ? 'default' : audit.status === 'in_progress' ? 'secondary' : 'outline'}>
                        {audit.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{audit.status === 'completed' ? `${Number(audit.overall_score).toFixed(0)}%` : '-'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openAudit(audit)}>
                          {audit.status === 'completed' ? <Eye className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        </Button>
                        {audit.status === 'completed' && (
                          <Button size="sm" variant="ghost" onClick={() => handlePrint(audit)}>
                            <Printer className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {audits.length === 0 && !isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No audits found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* New Audit Dialog */}
        <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New 5S Audit</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Department *</Label>
                <Select value={newDepartmentId} onValueChange={setNewDepartmentId}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {departments.map(d => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Remarks</Label>
                <Textarea value={newRemarks} onChange={e => setNewRemarks(e.target.value)} placeholder="Optional remarks..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNewDialog(false)}>Cancel</Button>
              <Button onClick={() => createAuditMutation.mutate()} disabled={!newDepartmentId || createAuditMutation.isPending}>
                Create Audit
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Audit Execution Dialog */}
        <Dialog open={showAuditDialog} onOpenChange={setShowAuditDialog}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {isViewOnly ? 'View' : 'Conduct'} Audit: {selectedAudit?.audit_number}
                {selectedAudit?.status === 'completed' && (
                  <Badge className="ml-2" variant="default">Score: {Number(selectedAudit.overall_score).toFixed(0)}%</Badge>
                )}
              </DialogTitle>
            </DialogHeader>

            {/* Category Tabs */}
            <div className="flex gap-2 flex-wrap">
              {S_CATEGORIES.map(cat => {
                const catCheckpoints = checkpoints.filter(c => c.category === cat);
                const answered = catCheckpoints.filter(c => auditResponses[c.id]?.response && auditResponses[c.id]?.response !== 'not_checked').length;
                return (
                  <Button
                    key={cat}
                    variant={activeCategory === cat ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setActiveCategory(cat)}
                  >
                    {cat} ({answered}/{catCheckpoints.length})
                  </Button>
                );
              })}
            </div>

            {/* Checkpoints */}
            <div className="space-y-4 mt-4">
              {categoryCheckpoints.map((cp, idx) => {
                const resp = auditResponses[cp.id];
                return (
                  <Card key={cp.id} className="p-4">
                    <div className="flex flex-col gap-3">
                      <p className="text-sm font-medium">{idx + 1}. {cp.checkpoint_text}</p>
                      {(cp as any).checkpoint_text_urdu && (
                        <p dir="rtl" className="text-sm text-muted-foreground text-right">{(cp as any).checkpoint_text_urdu}</p>
                      )}
                      <RadioGroup
                        value={resp?.response || 'not_checked'}
                        onValueChange={(val) => handleResponseChange(cp.id, val)}
                        className="flex gap-4"
                        disabled={isViewOnly}
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="yes" id={`${cp.id}-yes`} />
                          <Label htmlFor={`${cp.id}-yes`} className="text-green-600 font-medium">Yes</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="partial" id={`${cp.id}-partial`} />
                          <Label htmlFor={`${cp.id}-partial`} className="text-yellow-600 font-medium">Partial</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="no" id={`${cp.id}-no`} />
                          <Label htmlFor={`${cp.id}-no`} className="text-red-600 font-medium">No</Label>
                        </div>
                      </RadioGroup>
                      <Textarea
                        placeholder="Remarks (optional)"
                        value={resp?.remarks || ''}
                        onChange={e => handleRemarkChange(cp.id, e.target.value)}
                        className="h-16"
                        disabled={isViewOnly}
                      />
                    </div>
                  </Card>
                );
              })}
            </div>

            {!isViewOnly && (
              <DialogFooter className="mt-4">
                <Button variant="outline" onClick={() => saveResponsesMutation.mutate({ auditId: selectedAudit.id, complete: false })} disabled={saveResponsesMutation.isPending}>
                  Save Draft
                </Button>
                <Button onClick={() => saveResponsesMutation.mutate({ auditId: selectedAudit.id, complete: true })} disabled={saveResponsesMutation.isPending}>
                  <CheckCircle className="h-4 w-4 mr-2" /> Complete Audit
                </Button>
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
