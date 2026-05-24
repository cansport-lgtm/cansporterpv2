import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ShieldAlert, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export default function JobOrderDepartmentsPage() {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");

  const { data: departments = [] } = useQuery({
    queryKey: ["joed-departments"],
    queryFn: async () => {
      const { data } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true)
        .order("sequence_order");
      return data || [];
    },
    enabled: isSuperAdmin,
  });

  const { data: eligible = [] } = useQuery({
    queryKey: ["joed-eligible"],
    queryFn: async () => {
      const { data } = await supabase
        .from("job_order_eligible_departments")
        .select("department_id");
      return data || [];
    },
    enabled: isSuperAdmin,
  });

  const eligibleSet = new Set(eligible.map((r: any) => r.department_id));

  const toggle = useMutation({
    mutationFn: async ({ id, enable }: { id: string; enable: boolean }) => {
      if (enable) {
        const { error } = await supabase
          .from("job_order_eligible_departments")
          .insert({ department_id: id });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("job_order_eligible_departments")
          .delete()
          .eq("department_id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["joed-eligible"] });
      qc.invalidateQueries({ queryKey: ["jo-eligible-departments"] });
      toast.success("Updated");
    },
    onError: (e: any) => toast.error(e.message || "Failed to update"),
  });

  if (!isSuperAdmin) {
    return (
      <ERPLayout>
        <PageHeader
          title="Job Order Departments"
          description="Manage which departments are eligible for job orders"
          icon={ClipboardList}
        />
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-center text-muted-foreground">
            <ShieldAlert className="h-10 w-10 text-amber-500 mb-3" />
            <p className="font-medium">Access Restricted</p>
            <p className="text-sm">Only super admins can manage this setting.</p>
          </CardContent>
        </Card>
      </ERPLayout>
    );
  }

  return (
    <ERPLayout>
      <PageHeader
        title="Job Order Departments"
        description="Select departments that appear in the Job Order creation form"
        icon={ClipboardList}
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead>Code</TableHead>
                <TableHead className="text-right">Eligible for Job Orders</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    No active departments found.
                  </TableCell>
                </TableRow>
              )}
              {departments.map((d: any) => {
                const enabled = eligibleSet.has(d.id);
                return (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="text-muted-foreground">{d.code || "-"}</TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={enabled}
                        disabled={toggle.isPending}
                        onCheckedChange={(v) => toggle.mutate({ id: d.id, enable: v })}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ERPLayout>
  );
}
