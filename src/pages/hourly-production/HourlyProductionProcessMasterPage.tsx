import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Settings } from "lucide-react";
import { toast } from "sonner";

export default function HourlyProductionProcessMasterPage() {
  const queryClient = useQueryClient();
  const [selectedDepartment, setSelectedDepartment] = useState("all");

  const { data: departments = [] } = useQuery({
    queryKey: ["production-departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("production_departments").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: processes = [], isLoading } = useQuery({
    queryKey: ["hourly-process-master", selectedDepartment],
    queryFn: async () => {
      let query = supabase
        .from("qa_processes")
        .select("id, name, code, department_id, is_hourly_tracked, production_departments(name)")
        .eq("is_active", true);
      if (selectedDepartment !== "all") {
        query = query.eq("department_id", selectedDepartment);
      }
      const { data, error } = await (query as any).order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await (supabase as any)
        .from("qa_processes")
        .update({ is_hourly_tracked: value })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hourly-process-master"] });
      queryClient.invalidateQueries({ queryKey: ["qa-processes-hourly"] });
    },
    onError: () => toast.error("Failed to update tracking status"),
  });

  const trackedCount = processes.filter((p: any) => p.is_hourly_tracked).length;

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Hourly Process Master"
          description={`Select which processes to track hourly — ${trackedCount} of ${processes.length} enabled`}
          icon={Settings}
          iconColor="bg-violet-600 text-white"
        />

        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label>Filter by Department</Label>
                <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            {isLoading ? (
              <p className="text-muted-foreground text-center py-8">Loading processes...</p>
            ) : processes.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No active processes found</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Process Name</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead className="text-center">Hourly Tracking</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processes.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-sm">{p.code}</TableCell>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{p.production_departments?.name || "—"}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Switch
                            checked={!!p.is_hourly_tracked}
                            onCheckedChange={(val) => toggleMutation.mutate({ id: p.id, value: val })}
                          />
                          {p.is_hourly_tracked && (
                            <Badge variant="default" className="text-xs">Active</Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
