import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { History, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { dpDb, errorMessage, fmtDay, fmtQty, type PlannerVersion } from "@/lib/dispatchPlanner";

export default function DispatchPlannerVersionsPage() {
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const canManage = hasRole("super_admin") || hasRole("dispatch_planner_manager");
  const [toDelete, setToDelete] = useState<PlannerVersion | null>(null);

  const { data: versions = [], isLoading } = useQuery<PlannerVersion[]>({
    queryKey: ["dp-versions", "list"],
    queryFn: async () => {
      const { data, error } = await dpDb
        .from("dispatch_planner_versions")
        .select("*, creator:app_users!dispatch_planner_versions_created_by_fkey(full_name)")
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await dpDb.rpc("dispatch_planner_version_archive", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["dp-versions"] }); toast.success("Version removed"); setToDelete(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Saved Plan Versions" description="Snapshots of the suggested plan, saved from the board. Open one to print its loading sheets. Comparing a version with what was actually dispatched comes in phase 2." icon={History} />
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Saved</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Horizon</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Dozens</TableHead>
                  <TableHead className="text-right">Cartons</TableHead>
                  <TableHead>Settings used</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>}
                {!isLoading && versions.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Nothing saved yet. Use “Save as version” on the Suggested Plan board.</TableCell></TableRow>}
                {versions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell><Link to={`/dispatch-planner/versions/${v.id}`} className="font-mono font-semibold text-primary hover:underline">{v.version_number}</Link></TableCell>
                    <TableCell className="whitespace-nowrap">{format(new Date(v.created_at), "dd MMM yyyy, HH:mm")}</TableCell>
                    <TableCell>{v.creator?.full_name ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDay(v.horizon_from, "dd MMM")} – {fmtDay(v.horizon_to, "dd MMM")}</TableCell>
                    <TableCell className="max-w-[240px] truncate">{v.label ?? ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{v.line_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtQty(v.total_dozens)}</TableCell>
                    <TableCell className="text-right tabular-nums">{v.total_cartons}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">lead {v.params?.lead_time_days ?? "—"} wd · fleet {v.params?.fleet_cartons ?? "—"} ctn</TableCell>
                    <TableCell className="text-right">
                      {canManage && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setToDelete(v)}><Trash2 className="h-4 w-4" /></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {toDelete?.version_number}?</AlertDialogTitle>
              <AlertDialogDescription>The saved snapshot is hidden from the list (kept in the database for the record). Nothing outside the planner is affected.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => toDelete && del.mutate(toDelete.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ERPLayout>
  );
}
