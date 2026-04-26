import { useState, useEffect } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, FileText, GitBranch, BarChart3, AlertTriangle, List, Shield } from "lucide-react";

const TOOL_TYPES = [
  { value: "sipoc", label: "SIPOC", icon: List, description: "Suppliers, Inputs, Process, Outputs, Customers" },
  { value: "ctq_tree", label: "CTQ Tree", icon: GitBranch, description: "Critical to Quality decomposition" },
  { value: "fishbone", label: "Fishbone / Ishikawa", icon: GitBranch, description: "Cause & Effect diagram" },
  { value: "five_why", label: "5 Why Analysis", icon: AlertTriangle, description: "Root cause drill-down" },
  { value: "pareto", label: "Pareto Chart", icon: BarChart3, description: "80/20 analysis of defects" },
  { value: "control_chart", label: "Control Chart", icon: BarChart3, description: "Process stability monitoring" },
  { value: "process_map", label: "Process Map", icon: FileText, description: "Value stream / process flow" },
  { value: "control_plan", label: "Control Plan", icon: Shield, description: "Sustain improvements" },
];

// SIPOC template
const SIPOC_TEMPLATE = {
  suppliers: [""],
  inputs: [""],
  process_steps: [""],
  outputs: [""],
  customers: [""],
};

// Fishbone template
const FISHBONE_TEMPLATE = {
  problem: "",
  categories: {
    manpower: [""],
    machine: [""],
    method: [""],
    material: [""],
    measurement: [""],
    environment: [""],
  },
};

// 5 Why template
const FIVE_WHY_TEMPLATE = {
  problem: "",
  whys: [
    { question: "Why?", answer: "" },
    { question: "Why?", answer: "" },
    { question: "Why?", answer: "" },
    { question: "Why?", answer: "" },
    { question: "Why?", answer: "" },
  ],
  root_cause: "",
  countermeasure: "",
};

// Control Plan template
const CONTROL_PLAN_TEMPLATE = {
  items: [
    { process_step: "", characteristic: "", specification: "", measurement_method: "", sample_size: "", frequency: "", control_method: "", reaction_plan: "" },
  ],
};

function getDefaultTemplate(toolType: string) {
  switch (toolType) {
    case "sipoc": return SIPOC_TEMPLATE;
    case "fishbone": return FISHBONE_TEMPLATE;
    case "five_why": return FIVE_WHY_TEMPLATE;
    case "control_plan": return CONTROL_PLAN_TEMPLATE;
    case "ctq_tree": return { voice_of_customer: "", critical_needs: [""], ctqs: [""], specifications: [""] };
    case "pareto": return { categories: [{ name: "", count: 0 }] };
    case "control_chart": return { data_points: [{ value: 0, date: "" }], ucl: 0, lcl: 0, mean: 0 };
    case "process_map": return { steps: [{ step: "", description: "", responsible: "", value_add: true }] };
    default: return {};
  }
}

export default function SixSigmaToolsPage() {
  const [tools, setTools] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<any>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("all");

  const [form, setForm] = useState({
    project_id: "",
    tool_type: "sipoc",
    title: "",
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const [toolRes, projRes] = await Promise.all([
      supabase.from("six_sigma_tools").select("*, six_sigma_projects(project_number, title)").order("created_at", { ascending: false }),
      supabase.from("six_sigma_projects").select("id, project_number, title").eq("status", "active"),
    ]);
    setTools(toolRes.data || []);
    setProjects(projRes.data || []);
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!form.project_id || !form.title) {
      toast.error("Project and title are required");
      return;
    }
    const { error } = await supabase.from("six_sigma_tools").insert({
      project_id: form.project_id,
      tool_type: form.tool_type,
      title: form.title,
      tool_data: getDefaultTemplate(form.tool_type),
      status: "draft",
    });
    if (error) {
      toast.error("Failed to create: " + error.message);
      return;
    }
    toast.success("Tool template created!");
    setIsCreateOpen(false);
    setForm({ project_id: "", tool_type: "sipoc", title: "" });
    fetchData();
  };

  const handleSaveToolData = async (toolId: string, data: any) => {
    await supabase.from("six_sigma_tools").update({ tool_data: data }).eq("id", toolId);
    toast.success("Saved!");
    fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this tool entry?")) return;
    await supabase.from("six_sigma_tools").delete().eq("id", id);
    toast.success("Deleted");
    fetchData();
  };

  const filteredTools = activeTab === "all" ? tools : tools.filter((t) => t.tool_type === activeTab);

  const getToolLabel = (type: string) => TOOL_TYPES.find((t) => t.value === type)?.label || type;

  return (
    <ERPLayout>
      <div className="space-y-4">
        <PageHeader title="Six Sigma Tools" description="SIPOC, CTQ, Fishbone, 5-Why, Pareto, Control Plans & more">
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Tool
          </Button>
        </PageHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="all">All</TabsTrigger>
            {TOOL_TYPES.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Tool Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTools.length === 0 ? (
            <Card className="col-span-full">
              <CardContent className="text-center text-muted-foreground py-8">
                No tools created yet. Click "New Tool" to start.
              </CardContent>
            </Card>
          ) : (
            filteredTools.map((tool) => {
              const ToolIcon = TOOL_TYPES.find((t) => t.value === tool.tool_type)?.icon || FileText;
              return (
                <Card key={tool.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => { setSelectedTool(tool); setIsDetailOpen(true); }}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <ToolIcon className="h-5 w-5 text-primary" />
                        <CardTitle className="text-sm">{tool.title}</CardTitle>
                      </div>
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleDelete(tool.id); }}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-2 flex-wrap">
                      <Badge variant="secondary">{getToolLabel(tool.tool_type)}</Badge>
                      <Badge variant="outline">{tool.status}</Badge>
                      {tool.six_sigma_projects && (
                        <Badge variant="outline" className="text-xs">
                          {tool.six_sigma_projects.project_number}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Tool</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Project *</Label>
              <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tool Type</Label>
              <Select value={form.tool_type} onValueChange={(v) => setForm({ ...form, tool_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TOOL_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label} — {t.description}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Defect Root Cause Analysis" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail / Edit Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {selectedTool && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {getToolLabel(selectedTool.tool_type)}: {selectedTool.title}
                </DialogTitle>
              </DialogHeader>
              <ToolEditor
                tool={selectedTool}
                onSave={(data: any) => handleSaveToolData(selectedTool.id, data)}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}

// Generic Tool Editor based on tool_type
function ToolEditor({ tool, onSave }: { tool: any; onSave: (data: any) => void }) {
  const [data, setData] = useState<any>(tool.tool_data || {});

  const updateField = (path: string, value: any) => {
    const copy = JSON.parse(JSON.stringify(data));
    const keys = path.split(".");
    let target = copy;
    for (let i = 0; i < keys.length - 1; i++) {
      target = target[keys[i]];
    }
    target[keys[keys.length - 1]] = value;
    setData(copy);
  };

  const updateArrayItem = (path: string, index: number, value: string) => {
    const copy = JSON.parse(JSON.stringify(data));
    const keys = path.split(".");
    let target = copy;
    for (const k of keys) target = target[k];
    target[index] = value;
    setData(copy);
  };

  const addArrayItem = (path: string) => {
    const copy = JSON.parse(JSON.stringify(data));
    const keys = path.split(".");
    let target = copy;
    for (const k of keys) target = target[k];
    target.push("");
    setData(copy);
  };

  if (tool.tool_type === "sipoc") {
    return (
      <div className="space-y-4">
        {["suppliers", "inputs", "process_steps", "outputs", "customers"].map((section) => (
          <div key={section}>
            <div className="flex items-center justify-between">
              <Label className="capitalize font-semibold">{section.replace("_", " ")}</Label>
              <Button size="sm" variant="ghost" onClick={() => addArrayItem(section)}>
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            <div className="space-y-1 mt-1">
              {(data[section] || [""]).map((item: string, i: number) => (
                <Input
                  key={i}
                  value={item}
                  onChange={(e) => updateArrayItem(section, i, e.target.value)}
                  placeholder={`${section.replace("_", " ")} #${i + 1}`}
                />
              ))}
            </div>
          </div>
        ))}
        <Button onClick={() => onSave(data)}>Save SIPOC</Button>
      </div>
    );
  }

  if (tool.tool_type === "fishbone") {
    return (
      <div className="space-y-4">
        <div>
          <Label>Problem/Effect</Label>
          <Input value={data.problem || ""} onChange={(e) => updateField("problem", e.target.value)} />
        </div>
        {Object.keys(data.categories || {}).map((cat) => (
          <div key={cat}>
            <div className="flex items-center justify-between">
              <Label className="capitalize font-semibold">{cat}</Label>
              <Button size="sm" variant="ghost" onClick={() => {
                const copy = JSON.parse(JSON.stringify(data));
                copy.categories[cat].push("");
                setData(copy);
              }}>
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            <div className="space-y-1 mt-1">
              {(data.categories?.[cat] || [""]).map((cause: string, i: number) => (
                <Input
                  key={i}
                  value={cause}
                  onChange={(e) => {
                    const copy = JSON.parse(JSON.stringify(data));
                    copy.categories[cat][i] = e.target.value;
                    setData(copy);
                  }}
                  placeholder={`Cause #${i + 1}`}
                />
              ))}
            </div>
          </div>
        ))}
        <Button onClick={() => onSave(data)}>Save Fishbone</Button>
      </div>
    );
  }

  if (tool.tool_type === "five_why") {
    return (
      <div className="space-y-4">
        <div>
          <Label>Problem Statement</Label>
          <Input value={data.problem || ""} onChange={(e) => updateField("problem", e.target.value)} />
        </div>
        {(data.whys || []).map((why: any, i: number) => (
          <div key={i}>
            <Label>Why #{i + 1}</Label>
            <Textarea
              value={why.answer || ""}
              onChange={(e) => {
                const copy = JSON.parse(JSON.stringify(data));
                copy.whys[i].answer = e.target.value;
                setData(copy);
              }}
              rows={2}
              placeholder={`Answer to Why #${i + 1}`}
            />
          </div>
        ))}
        <div>
          <Label>Root Cause</Label>
          <Textarea value={data.root_cause || ""} onChange={(e) => updateField("root_cause", e.target.value)} rows={2} />
        </div>
        <div>
          <Label>Countermeasure</Label>
          <Textarea value={data.countermeasure || ""} onChange={(e) => updateField("countermeasure", e.target.value)} rows={2} />
        </div>
        <Button onClick={() => onSave(data)}>Save 5-Why</Button>
      </div>
    );
  }

  if (tool.tool_type === "control_plan") {
    return (
      <div className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="p-1 text-left">Process Step</th>
                <th className="p-1 text-left">Characteristic</th>
                <th className="p-1 text-left">Spec</th>
                <th className="p-1 text-left">Method</th>
                <th className="p-1 text-left">Frequency</th>
                <th className="p-1 text-left">Control</th>
                <th className="p-1 text-left">Reaction</th>
              </tr>
            </thead>
            <tbody>
              {(data.items || []).map((item: any, i: number) => (
                <tr key={i} className="border-b">
                  {["process_step", "characteristic", "specification", "measurement_method", "frequency", "control_method", "reaction_plan"].map((field) => (
                    <td key={field} className="p-1">
                      <Input
                        className="text-xs h-8"
                        value={item[field] || ""}
                        onChange={(e) => {
                          const copy = JSON.parse(JSON.stringify(data));
                          copy.items[i][field] = e.target.value;
                          setData(copy);
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button size="sm" variant="outline" onClick={() => {
          const copy = JSON.parse(JSON.stringify(data));
          copy.items.push({ process_step: "", characteristic: "", specification: "", measurement_method: "", sample_size: "", frequency: "", control_method: "", reaction_plan: "" });
          setData(copy);
        }}>
          <Plus className="mr-1 h-3 w-3" /> Add Row
        </Button>
        <Button onClick={() => onSave(data)}>Save Control Plan</Button>
      </div>
    );
  }

  // Generic JSON editor fallback
  return (
    <div className="space-y-4">
      <Textarea
        className="font-mono text-xs"
        rows={15}
        value={JSON.stringify(data, null, 2)}
        onChange={(e) => {
          try {
            setData(JSON.parse(e.target.value));
          } catch {}
        }}
      />
      <Button onClick={() => onSave(data)}>Save</Button>
    </div>
  );
}
