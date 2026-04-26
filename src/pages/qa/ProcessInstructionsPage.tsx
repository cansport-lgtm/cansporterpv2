import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
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
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  FileText,
  StickyNote,
  Play,
  Image as ImageIcon,
  ArrowUp,
  ArrowDown,
  Printer,
} from "lucide-react";

export default function ProcessInstructionsPage() {
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const processIdFromUrl = searchParams.get("process") || "";

  const [selectedProcessId, setSelectedProcessId] = useState(processIdFromUrl);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingInstruction, setEditingInstruction] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [uploading, setUploading] = useState(false);

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    instruction_type: "step",
    image_url: "",
    video_url: "",
  });

  // Fetch departments
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true)
        .order("sequence_order");
      if (error) throw error;
      return data;
    },
  });

  // Fetch processes
  const { data: processes = [] } = useQuery({
    queryKey: ["qa-processes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_processes")
        .select("*, production_departments(name)")
        .order("sequence_order");
      if (error) throw error;
      return data;
    },
  });

  // Auto-select department when process comes from URL
  useEffect(() => {
    if (processIdFromUrl && processes.length > 0) {
      const proc = processes.find((p: any) => p.id === processIdFromUrl);
      if (proc) {
        setSelectedDepartmentId(proc.department_id || "");
        setSelectedProcessId(proc.id);
      }
    }
  }, [processIdFromUrl, processes]);

  const filteredProcesses = selectedDepartmentId
    ? processes.filter((p: any) => p.department_id === selectedDepartmentId)
    : processes;

  // Fetch instructions for selected process
  const { data: instructions = [], isLoading } = useQuery({
    queryKey: ["qa-process-instructions", selectedProcessId],
    queryFn: async () => {
      if (!selectedProcessId) return [];
      const { data, error } = await supabase
        .from("qa_process_instructions")
        .select("*")
        .eq("process_id", selectedProcessId)
        .order("step_number");
      if (error) throw error;
      return data;
    },
    enabled: !!selectedProcessId,
  });

  const resetForm = () => {
    setFormData({ title: "", description: "", instruction_type: "step", image_url: "", video_url: "" });
    setEditingInstruction(null);
  };

  const handleAdd = () => {
    resetForm();
    setShowDialog(true);
  };

  const handleEdit = (instruction: any) => {
    setEditingInstruction(instruction);
    setFormData({
      title: instruction.title,
      description: instruction.description || "",
      instruction_type: instruction.instruction_type,
      image_url: instruction.image_url || "",
      video_url: instruction.video_url || "",
    });
    setShowDialog(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("qa-instructions")
        .upload(path, file);
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("qa-instructions").getPublicUrl(path);
      setFormData({ ...formData, image_url: urlData.publicUrl });
      toast.success("Image uploaded!");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const nextStep = editingInstruction
        ? editingInstruction.step_number
        : (instructions.length > 0 ? Math.max(...instructions.map((i: any) => i.step_number)) + 1 : 1);

      const payload = {
        process_id: selectedProcessId,
        step_number: nextStep,
        title: formData.title,
        description: formData.description || null,
        instruction_type: formData.instruction_type,
        image_url: formData.image_url || null,
        video_url: formData.video_url || null,
        created_by: user?.id || null,
      };

      if (editingInstruction) {
        const { error } = await supabase
          .from("qa_process_instructions")
          .update(payload)
          .eq("id", editingInstruction.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("qa_process_instructions").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-process-instructions", selectedProcessId] });
      toast.success(editingInstruction ? "Instruction updated!" : "Instruction added!");
      setShowDialog(false);
      resetForm();
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("qa_process_instructions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-process-instructions", selectedProcessId] });
      toast.success("Instruction deleted!");
      setShowDeleteDialog(false);
      setDeleteTarget(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Reorder mutation
  const reorderMutation = useMutation({
    mutationFn: async ({ id, newStep }: { id: string; newStep: number }) => {
      const { error } = await supabase
        .from("qa_process_instructions")
        .update({ step_number: newStep })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-process-instructions", selectedProcessId] });
    },
  });

  const handleMoveUp = (instruction: any, index: number) => {
    if (index === 0) return;
    const prev = instructions[index - 1];
    reorderMutation.mutate({ id: instruction.id, newStep: prev.step_number });
    reorderMutation.mutate({ id: prev.id, newStep: instruction.step_number });
  };

  const handleMoveDown = (instruction: any, index: number) => {
    if (index === instructions.length - 1) return;
    const next = instructions[index + 1];
    reorderMutation.mutate({ id: instruction.id, newStep: next.step_number });
    reorderMutation.mutate({ id: next.id, newStep: instruction.step_number });
  };

  const typeIcon = (type: string) => {
    if (type === "safety") return <AlertTriangle className="h-4 w-4 text-orange-500" />;
    if (type === "note") return <StickyNote className="h-4 w-4 text-blue-500" />;
    return <FileText className="h-4 w-4 text-primary" />;
  };

  const typeBg = (type: string) => {
    if (type === "safety") return "border-orange-300 bg-orange-50 dark:bg-orange-950/20";
    if (type === "note") return "border-blue-300 bg-blue-50 dark:bg-blue-950/20";
    return "";
  };

  const getYouTubeEmbedUrl = (url: string) => {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
    return match ? `https://www.youtube.com/embed/${match[1]}` : null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate();
  };

  const selectedProcess = processes.find((p: any) => p.id === selectedProcessId);
  const selectedProcessName = selectedProcess?.name || "";
  const selectedProcessCode = selectedProcess?.code || "";
  const selectedDeptName = selectedProcess?.production_departments?.name || "";

  const handlePrint = () => {
    const steps = instructions.filter((i: any) => i.instruction_type === "step");
    const safetyNotes = instructions.filter((i: any) => i.instruction_type === "safety");
    const notes = instructions.filter((i: any) => i.instruction_type === "note");

    const renderItems = (items: any[], label: string, color: string) => {
      if (items.length === 0) return "";
      return `
        <div style="margin-bottom:16px;">
          <h2 style="font-size:16px;font-weight:bold;margin-bottom:8px;padding:4px 8px;background:${color};border-radius:4px;">${label}</h2>
          ${items.map((inst: any, i: number) => `
            <div style="margin-bottom:8px;padding:6px 10px;border:1px solid #ddd;border-radius:4px;">
              <div style="font-weight:600;font-size:14px;">${inst.instruction_type === "step" ? `Step ${i + 1}: ` : ""}${inst.title}</div>
              ${inst.description ? `<div style="font-size:13px;color:#444;white-space:pre-wrap;margin-top:4px;">${inst.description}</div>` : ""}
              ${inst.image_url ? `<img src="${inst.image_url}" style="max-height:120px;margin-top:6px;border:1px solid #ccc;border-radius:4px;" />` : ""}
            </div>
          `).join("")}
        </div>
      `;
    };

    const printContent = `
      <html>
      <head>
        <title>Process Instructions - ${selectedProcessCode} ${selectedProcessName}</title>
        <style>
          @media print { body { margin: 0; } @page { margin: 10mm; } }
          body { font-family: Arial, sans-serif; padding: 16px; color: #111; }
          .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 16px; }
          .header h1 { font-size: 20px; margin: 0; }
          .header p { font-size: 13px; color: #555; margin: 4px 0 0; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${selectedProcessCode} - ${selectedProcessName}</h1>
          <p>Department: ${selectedDeptName} | Printed: ${new Date().toLocaleDateString()}</p>
        </div>
        ${renderItems(steps, "📋 Process Steps", "#e8f5e9")}
        ${renderItems(safetyNotes, "⚠️ Safety / Precautions", "#fff3e0")}
        ${renderItems(notes, "📝 Notes", "#e3f2fd")}
        ${instructions.length === 0 ? "<p style='text-align:center;color:#999;'>No instructions available.</p>" : ""}
      </body>
      </html>
    `;

    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      setTimeout(() => printWindow.print(), 500);
    }
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Process Instructions"
          description="Manage step-by-step process instructions for QA processes"
        >
          <div className="flex gap-2">
            {selectedProcessId && instructions.length > 0 && isSuperAdmin && (
              <Button variant="outline" onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
            )}
            {selectedProcessId && isSuperAdmin && (
              <Button onClick={handleAdd}>
                <Plus className="h-4 w-4 mr-2" />
                Add Step
              </Button>
            )}
          </div>
        </PageHeader>

        {/* Process Selector */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Department</Label>
            <Select
              value={selectedDepartmentId}
              onValueChange={(v) => {
                setSelectedDepartmentId(v);
                setSelectedProcessId("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Process *</Label>
            <Select
              value={selectedProcessId}
              onValueChange={(v) => {
                setSelectedProcessId(v);
                setSearchParams({ process: v });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a process" />
              </SelectTrigger>
              <SelectContent>
                {filteredProcesses.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.code} - {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Instructions List */}
        {selectedProcessId && (
          <div className="space-y-4">
            {instructions.length === 0 && !isLoading && (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  No instructions found for {selectedProcessName}.{isSuperAdmin && ' Click "Add Step" to create one.'}
                </CardContent>
              </Card>
            )}

            {instructions.map((inst: any, idx: number) => (
              <Card key={inst.id} className={`relative ${typeBg(inst.instruction_type)}`}>
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {typeIcon(inst.instruction_type)}
                      <span className="text-xs font-medium text-muted-foreground uppercase">
                        {inst.instruction_type === "safety" ? "⚠️ Safety" : inst.instruction_type === "note" ? "📝 Note" : `Step ${inst.step_number}`}
                      </span>
                    </div>
                    {isSuperAdmin && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleMoveUp(inst, idx)} disabled={idx === 0}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleMoveDown(inst, idx)} disabled={idx === instructions.length - 1}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(inst)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setDeleteTarget(inst); setShowDeleteDialog(true); }}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <h3 className="font-semibold text-base">{inst.title}</h3>
                  {inst.description && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{inst.description}</p>}
                  {inst.image_url && (
                    <div className="mt-2">
                      <img src={inst.image_url} alt={inst.title} className="max-h-60 rounded-md border object-contain" />
                    </div>
                  )}
                  {inst.video_url && (
                    <div className="mt-2">
                      {getYouTubeEmbedUrl(inst.video_url) ? (
                        <iframe
                          src={getYouTubeEmbedUrl(inst.video_url)!}
                          className="w-full max-w-lg aspect-video rounded-md"
                          allowFullScreen
                        />
                      ) : (
                        <a href={inst.video_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                          <Play className="h-4 w-4" /> Watch Video
                        </a>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingInstruction ? "Edit Instruction" : "Add Instruction Step"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={formData.instruction_type} onValueChange={(v) => setFormData({ ...formData, instruction_type: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="step">Step</SelectItem>
                    <SelectItem value="safety">Safety / Precaution</SelectItem>
                    <SelectItem value="note">Note</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Title *</Label>
                <Input
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g., Check die alignment"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Detailed instructions..."
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <Label>Image / Document</Label>
                <div className="flex items-center gap-2">
                  <Input type="file" accept="image/*,.pdf" onChange={handleImageUpload} disabled={uploading} />
                </div>
                {formData.image_url && (
                  <div className="relative">
                    <img src={formData.image_url} alt="Preview" className="max-h-32 rounded border object-contain" />
                    <Button type="button" variant="ghost" size="icon" className="absolute top-0 right-0 h-6 w-6" onClick={() => setFormData({ ...formData, image_url: "" })}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Video URL</Label>
                <Input
                  value={formData.video_url}
                  onChange={(e) => setFormData({ ...formData, video_url: e.target.value })}
                  placeholder="https://youtube.com/watch?v=..."
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
                <Button type="submit" disabled={saveMutation.isPending || uploading}>
                  {saveMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Instruction?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove "{deleteTarget?.title}". This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ERPLayout>
  );
}
