import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProcessInstructionsPanel } from "@/components/qa/ProcessInstructionsPanel";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { CheckCircle2, AlertCircle, ClipboardCheck } from "lucide-react";
import { Input } from "@/components/ui/input";

export default function InstructionAcknowledgementPage() {
  const { user, hasRole } = useAuth();
  const queryClient = useQueryClient();
  const isSuperAdmin = hasRole("super_admin");

  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [selectedDeptId, setSelectedDeptId] = useState<string>(user?.department_id || "");
  const [expandedProcesses, setExpandedProcesses] = useState<Set<string>>(new Set());
  const [checkedProcesses, setCheckedProcesses] = useState<Set<string>>(new Set());

  // Admin report filters
  const [reportDate, setReportDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reportDeptId, setReportDeptId] = useState<string>("");

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Auto-select department from user profile
  useState(() => {
    if (user?.department_id && !selectedDeptId) {
      setSelectedDeptId(user.department_id);
    }
  });

  // Fetch processes that have instructions for selected department
  const { data: processesWithInstructions = [] } = useQuery({
    queryKey: ["ack-processes", selectedDeptId],
    queryFn: async () => {
      if (!selectedDeptId) return [];
      // Get processes for department
      const { data: processes, error: pErr } = await supabase
        .from("qa_processes")
        .select("id, name, code, department_id")
        .eq("department_id", selectedDeptId)
        .eq("is_active", true)
        .order("name");
      if (pErr) throw pErr;
      if (!processes?.length) return [];

      // Get which processes have active instructions
      const processIds = processes.map((p) => p.id);
      const { data: instrCounts, error: iErr } = await supabase
        .from("qa_process_instructions")
        .select("process_id")
        .in("process_id", processIds)
        .eq("is_active", true);
      if (iErr) throw iErr;

      const processIdsWithInstr = new Set((instrCounts || []).map((i: any) => i.process_id));
      return processes.filter((p) => processIdsWithInstr.has(p.id));
    },
    enabled: !!selectedDeptId,
  });

  // Fetch existing acknowledgements for selected date and user
  const { data: existingAcks = [] } = useQuery({
    queryKey: ["ack-existing", user?.id, selectedDate, selectedDeptId],
    queryFn: async () => {
      if (!user?.id || !selectedDeptId) return [];
      const { data, error } = await supabase
        .from("qa_instruction_acknowledgements")
        .select("process_id")
        .eq("user_id", user.id)
        .eq("department_id", selectedDeptId)
        .eq("acknowledgement_date", selectedDate);
      if (error) throw error;
      return (data || []).map((a: any) => a.process_id);
    },
    enabled: !!user?.id && !!selectedDeptId,
  });

  const alreadyAckedSet = useMemo(() => new Set(existingAcks), [existingAcks]);

  const totalProcesses = processesWithInstructions.length;
  const ackedCount = existingAcks.length;
  const newCheckedCount = [...checkedProcesses].filter((id) => !alreadyAckedSet.has(id)).length;
  const pendingCount = totalProcesses - ackedCount;

  const toggleExpand = (processId: string) => {
    setExpandedProcesses((prev) => {
      const next = new Set(prev);
      if (next.has(processId)) next.delete(processId);
      else next.add(processId);
      return next;
    });
  };

  const toggleCheck = (processId: string) => {
    if (alreadyAckedSet.has(processId)) return;
    setCheckedProcesses((prev) => {
      const next = new Set(prev);
      if (next.has(processId)) next.delete(processId);
      else next.add(processId);
      return next;
    });
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const newAcks = [...checkedProcesses]
        .filter((id) => !alreadyAckedSet.has(id))
        .map((process_id) => ({
          user_id: user!.id,
          department_id: selectedDeptId,
          process_id,
          acknowledgement_date: selectedDate,
        }));
      if (!newAcks.length) throw new Error("No new processes to acknowledge");
      const { error } = await supabase.from("qa_instruction_acknowledgements").insert(newAcks);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Acknowledgement submitted successfully" });
      setCheckedProcesses(new Set());
      queryClient.invalidateQueries({ queryKey: ["ack-existing"] });
      queryClient.invalidateQueries({ queryKey: ["ack-report"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // === Admin Report ===
  const { data: reportData = [] } = useQuery({
    queryKey: ["ack-report", reportDate, reportDeptId],
    queryFn: async () => {
      if (!reportDeptId) return [];
      // Get all processes with instructions for that dept
      const { data: procs } = await supabase
        .from("qa_processes")
        .select("id, name")
        .eq("department_id", reportDeptId)
        .eq("is_active", true);
      if (!procs?.length) return [];

      const procIds = procs.map((p) => p.id);
      const { data: instrCheck } = await supabase
        .from("qa_process_instructions")
        .select("process_id")
        .in("process_id", procIds)
        .eq("is_active", true);
      const validProcIds = new Set((instrCheck || []).map((i: any) => i.process_id));
      const totalProcs = procs.filter((p) => validProcIds.has(p.id)).length;
      if (!totalProcs) return [];

      // Get acks for that date and dept
      const { data: acks } = await supabase
        .from("qa_instruction_acknowledgements")
        .select("user_id, process_id")
        .eq("department_id", reportDeptId)
        .eq("acknowledgement_date", reportDate);

      // Group by user
      const userMap: Record<string, Set<string>> = {};
      (acks || []).forEach((a: any) => {
        if (!userMap[a.user_id]) userMap[a.user_id] = new Set();
        userMap[a.user_id].add(a.process_id);
      });

      // Get user names
      const userIds = Object.keys(userMap);
      if (!userIds.length) return [];
      const { data: users } = await supabase
        .from("app_users")
        .select("id, full_name")
        .in("id", userIds);

      const nameMap: Record<string, string> = {};
      (users || []).forEach((u: any) => {
        nameMap[u.id] = u.full_name;
      });

      return userIds.map((uid) => ({
        userId: uid,
        userName: nameMap[uid] || "Unknown",
        acknowledged: userMap[uid].size,
        total: totalProcs,
        percentage: Math.round((userMap[uid].size / totalProcs) * 100),
      }));
    },
    enabled: isSuperAdmin && !!reportDeptId,
  });

  return (
    <ERPLayout>
      <PageHeader title="Daily Instruction Acknowledgement" />

      {isSuperAdmin ? (
        <Tabs defaultValue="acknowledge" className="space-y-4">
          <TabsList>
            <TabsTrigger value="acknowledge">My Acknowledgement</TabsTrigger>
            <TabsTrigger value="report">Acknowledgement Status</TabsTrigger>
          </TabsList>

          <TabsContent value="acknowledge">
            <AcknowledgeSection
              departments={departments}
              selectedDeptId={selectedDeptId}
              setSelectedDeptId={setSelectedDeptId}
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              processesWithInstructions={processesWithInstructions}
              alreadyAckedSet={alreadyAckedSet}
              expandedProcesses={expandedProcesses}
              checkedProcesses={checkedProcesses}
              toggleExpand={toggleExpand}
              toggleCheck={toggleCheck}
              totalProcesses={totalProcesses}
              ackedCount={ackedCount}
              pendingCount={pendingCount}
              newCheckedCount={newCheckedCount}
              onSubmit={() => submitMutation.mutate()}
              isSubmitting={submitMutation.isPending}
            />
          </TabsContent>

          <TabsContent value="report">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Input
                  type="date"
                  value={reportDate}
                  onChange={(e) => setReportDate(e.target.value)}
                  className="w-44"
                />
                <Select value={reportDeptId} onValueChange={setReportDeptId}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="Select Department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {reportDeptId && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Acknowledgement Status — {format(new Date(reportDate), "dd MMM yyyy")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {reportData.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No acknowledgements found for this date and department.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Supervisor</TableHead>
                            <TableHead className="text-center">Acknowledged</TableHead>
                            <TableHead className="text-center">Total</TableHead>
                            <TableHead className="text-center">Completion %</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reportData.map((row: any) => (
                            <TableRow key={row.userId}>
                              <TableCell className="font-medium">{row.userName}</TableCell>
                              <TableCell className="text-center">{row.acknowledged}</TableCell>
                              <TableCell className="text-center">{row.total}</TableCell>
                              <TableCell className="text-center">
                                <span className={row.percentage < 100 ? "text-destructive font-semibold" : "text-green-600 font-semibold"}>
                                  {row.percentage}%
                                </span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      ) : (
        <AcknowledgeSection
          departments={departments}
          selectedDeptId={selectedDeptId}
          setSelectedDeptId={setSelectedDeptId}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          processesWithInstructions={processesWithInstructions}
          alreadyAckedSet={alreadyAckedSet}
          expandedProcesses={expandedProcesses}
          checkedProcesses={checkedProcesses}
          toggleExpand={toggleExpand}
          toggleCheck={toggleCheck}
          totalProcesses={totalProcesses}
          ackedCount={ackedCount}
          pendingCount={pendingCount}
          newCheckedCount={newCheckedCount}
          onSubmit={() => submitMutation.mutate()}
          isSubmitting={submitMutation.isPending}
        />
      )}
    </ERPLayout>
  );
}

function AcknowledgeSection({
  departments,
  selectedDeptId,
  setSelectedDeptId,
  selectedDate,
  setSelectedDate,
  processesWithInstructions,
  alreadyAckedSet,
  expandedProcesses,
  checkedProcesses,
  toggleExpand,
  toggleCheck,
  totalProcesses,
  ackedCount,
  pendingCount,
  newCheckedCount,
  onSubmit,
  isSubmitting,
}: any) {
  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Date</label>
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-44"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Department</label>
          <Select value={selectedDeptId} onValueChange={setSelectedDeptId}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Select Department" />
            </SelectTrigger>
            <SelectContent>
              {departments.map((d: any) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 flex items-center gap-3">
            <ClipboardCheck className="h-8 w-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">{totalProcesses}</p>
              <p className="text-xs text-muted-foreground">Total Processes</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 flex items-center gap-3">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
            <div>
              <p className="text-2xl font-bold">{ackedCount}</p>
              <p className="text-xs text-muted-foreground">Acknowledged</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 flex items-center gap-3">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <div>
              <p className="text-2xl font-bold">{pendingCount}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Process List */}
      {!selectedDeptId ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Select a department to view processes.</CardContent></Card>
      ) : processesWithInstructions.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No processes with instructions found for this department.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {processesWithInstructions.map((proc: any) => {
            const isAcked = alreadyAckedSet.has(proc.id);
            const isExpanded = expandedProcesses.has(proc.id);
            const isChecked = isAcked || checkedProcesses.has(proc.id);
            const canCheck = isExpanded || isAcked;

            return (
              <Card key={proc.id} className={isAcked ? "border-green-300 bg-green-50/30 dark:bg-green-950/10" : ""}>
                <CardContent className="py-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={isChecked}
                      disabled={isAcked || !canCheck}
                      onCheckedChange={() => toggleCheck(proc.id)}
                    />
                    <button
                      type="button"
                      className="flex-1 text-left text-sm font-medium hover:underline"
                      onClick={() => toggleExpand(proc.id)}
                    >
                      {proc.code} — {proc.name}
                      {isAcked && <span className="ml-2 text-xs text-green-600">(Acknowledged)</span>}
                    </button>
                    {!canCheck && !isAcked && (
                      <span className="text-xs text-muted-foreground italic">Expand to read before checking</span>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="ml-7">
                      <ProcessInstructionsPanel processId={proc.id} />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <Button
            onClick={onSubmit}
            disabled={isSubmitting || newCheckedCount === 0}
            className="mt-4"
          >
            Submit Acknowledgement ({newCheckedCount} process{newCheckedCount !== 1 ? "es" : ""})
          </Button>
        </div>
      )}
    </div>
  );
}
