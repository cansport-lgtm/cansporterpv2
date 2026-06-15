import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Recycle, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";

export default function ReworkTrackingPage() {
  const [status, setStatus] = useState<string>("all");

  const { data: depts = [] } = useQuery({
    queryKey: ["rework-depts"],
    queryFn: async () => {
      const { data } = await supabase.from("production_departments").select("id, name");
      return data || [];
    },
  });
  const { data: products = [] } = useQuery({
    queryKey: ["rework-products"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("id, name, code");
      return data || [];
    },
  });

  const { data: rows = [], refetch, isLoading } = useQuery({
    queryKey: ["rework-list", status],
    queryFn: async () => {
      let q = supabase.from("rw_rejections").select("*").eq("disposition", "rework").order("entry_date", { ascending: false });
      if (status !== "all") q = q.eq("rework_status", status);
      const { data } = await q;
      return data || [];
    },
  });

  const deptMap = useMemo(() => Object.fromEntries(depts.map((d: any) => [d.id, d.name])), [depts]);
  const productMap = useMemo(() => Object.fromEntries(products.map((p: any) => [p.id, p])), [products]);

  const updateStatus = async (id: string, newStatus: string) => {
    const patch: any = { rework_status: newStatus };
    if (newStatus === "completed") patch.rework_completed_at = new Date().toISOString();
    const { error } = await supabase.from("rw_rejections").update(patch).eq("id", id);
    if (error) return toast({ title: "Update failed", variant: "destructive" });
    refetch();
  };

  const updateReworkQty = async (id: string, qty: number) => {
    await supabase.from("rw_rejections").update({ rework_qty: qty }).eq("id", id);
    refetch();
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Rework Tracking"
          description="Rejections flagged for rework — track repair progress"
          icon={Recycle}
          iconColor="bg-blue-500 text-white"
        />

        <Card>
          <CardContent className="p-3 md:p-4 flex flex-wrap gap-2 items-end">
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 md:p-4"><CardTitle className="text-base">Rework Items ({rows.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Rejected</TableHead>
                    <TableHead className="text-right">Reworked</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && <TableRow><TableCell colSpan={7} className="text-center py-6"><Loader2 className="h-4 w-4 animate-spin inline" /></TableCell></TableRow>}
                  {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No rework items.</TableCell></TableRow>}
                  {rows.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">{format(new Date(r.entry_date), "dd MMM yy")}</TableCell>
                      <TableCell>{deptMap[r.department_id] || "—"}</TableCell>
                      <TableCell className="max-w-[180px] truncate">{productMap[r.product_id]?.name || "—"}</TableCell>
                      <TableCell className="text-right">{r.rejected_qty} {r.unit}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          className="w-20 h-8 inline-block text-right"
                          defaultValue={r.rework_qty || 0}
                          onBlur={(e) => {
                            const v = parseFloat(e.target.value) || 0;
                            if (v !== Number(r.rework_qty)) updateReworkQty(r.id, v);
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.rework_status === "completed" ? "default" : r.rework_status === "in_progress" ? "secondary" : "outline"}>
                          {r.rework_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="space-x-1">
                        {r.rework_status !== "in_progress" && r.rework_status !== "completed" && (
                          <Button size="sm" variant="outline" onClick={() => updateStatus(r.id, "in_progress")}>Start</Button>
                        )}
                        {r.rework_status !== "completed" && (
                          <Button size="sm" onClick={() => updateStatus(r.id, "completed")}>
                            <CheckCircle2 className="h-3 w-3 mr-1" />Done
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
