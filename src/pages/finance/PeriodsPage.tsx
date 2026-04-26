import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Plus, Lock, Unlock, Calendar } from "lucide-react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function PeriodsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const currentYear = new Date().getFullYear();
  const [newYear, setNewYear] = useState(currentYear);
  const [newMonth, setNewMonth] = useState(new Date().getMonth() + 1);

  const { data: periods, isLoading } = useQuery({
    queryKey: ["finance-periods-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("finance_periods").select("*").order("year", { ascending: false }).order("month", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const startDate = `${newYear}-${String(newMonth).padStart(2, "0")}-01`;
      const endDate = new Date(newYear, newMonth, 0).toISOString().split("T")[0];
      const { error } = await supabase.from("finance_periods").insert({
        period_name: `${MONTHS[newMonth - 1]} ${newYear}`,
        year: newYear,
        month: newMonth,
        start_date: startDate,
        end_date: endDate,
        status: "open" as any,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-periods-all"] });
      toast({ title: "Period created" });
      setDialogOpen(false);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleClose = useMutation({
    mutationFn: async ({ id, isClosed }: { id: string; isClosed: boolean }) => {
      const { error } = await supabase.from("finance_periods").update({
        is_closed: !isClosed,
        status: (!isClosed ? "closed" : "open") as any,
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-periods-all"] });
      toast({ title: "Period updated" });
    },
  });

  const getStatusBadge = (status: string, isClosed: boolean) => {
    if (isClosed) return <Badge variant="secondary">Closed</Badge>;
    if (status === "open") return <Badge className="bg-green-100 text-green-800">Open</Badge>;
    return <Badge variant="outline">{status}</Badge>;
  };

  return (
    <ERPLayout>
      <PageHeader title="Financial Periods" description="Manage monthly accounting periods">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />New Period</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Period</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Year</Label>
                  <Input type="number" value={newYear} onChange={(e) => setNewYear(parseInt(e.target.value))} />
                </div>
                <div>
                  <Label>Month</Label>
                  <Select value={newMonth.toString()} onValueChange={(v) => setNewMonth(parseInt(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m, i) => <SelectItem key={i} value={(i + 1).toString()}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button className="w-full" onClick={() => createMutation.mutate()}>Create Period</Button>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Year</TableHead>
              <TableHead>Start Date</TableHead>
              <TableHead>End Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : !periods?.length ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No periods created</TableCell></TableRow>
            ) : (
              periods.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium"><Calendar className="inline h-4 w-4 mr-2 text-muted-foreground" />{p.period_name}</TableCell>
                  <TableCell>{p.year}</TableCell>
                  <TableCell>{p.start_date}</TableCell>
                  <TableCell>{p.end_date}</TableCell>
                  <TableCell>{getStatusBadge(p.status || "draft", p.is_closed || false)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => toggleClose.mutate({ id: p.id, isClosed: p.is_closed || false })}>
                      {p.is_closed ? <Unlock className="h-4 w-4 mr-1" /> : <Lock className="h-4 w-4 mr-1" />}
                      {p.is_closed ? "Reopen" : "Close"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </ERPLayout>
  );
}
