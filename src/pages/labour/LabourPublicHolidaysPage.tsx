import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, Edit, Search, AlertCircle } from "lucide-react";
import { format, parseISO, getDay } from "date-fns";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/contexts/AuthContext";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function LabourPublicHolidaysPage() {
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formDate, setFormDate] = useState("");
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 1 + i);

  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ["public-holidays", selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("public_holidays" as any)
        .select("*")
        .gte("holiday_date", `${selectedYear}-01-01`)
        .lte("holiday_date", `${selectedYear}-12-31`)
        .order("holiday_date");
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!formDate || !formName) throw new Error("Date and Name are required");
      if (editingId) {
        const { error } = await supabase
          .from("public_holidays" as any)
          .update({ holiday_date: formDate, name: formName, description: formDescription || null } as any)
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("public_holidays" as any)
          .insert({ holiday_date: formDate, name: formName, description: formDescription || null } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Holiday updated" : "Holiday added");
      queryClient.invalidateQueries({ queryKey: ["public-holidays"] });
      resetForm();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("public_holidays" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Holiday deleted");
      queryClient.invalidateQueries({ queryKey: ["public-holidays"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("public_holidays" as any)
        .update({ is_active } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["public-holidays"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetForm = () => {
    setDialogOpen(false);
    setEditingId(null);
    setFormDate("");
    setFormName("");
    setFormDescription("");
  };

  const openEdit = (h: any) => {
    setEditingId(h.id);
    setFormDate(h.holiday_date);
    setFormName(h.name);
    setFormDescription(h.description || "");
    setDialogOpen(true);
  };

  const filtered = holidays.filter(
    (h: any) =>
      h.name.toLowerCase().includes(search.toLowerCase()) ||
      h.holiday_date.includes(search)
  );

  return (
    <ERPLayout>
      <PageHeader title="Public Holidays - Labour" description="Manage public holidays for labour salary calculations (treated same as Sunday)" />

      <Alert className="mb-4 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
        <AlertCircle className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-800 dark:text-blue-200">
          <strong>Policy:</strong> All public holidays follow the same rules as Sundays — labour workers get paid for public holidays if they are present on adjacent working days. These holidays are shared across HR and Labour modules.
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search holidays..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Add Holiday
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Holiday Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No public holidays found for {selectedYear}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((h: any, idx: number) => {
                    const date = parseISO(h.holiday_date);
                    const dayName = DAY_NAMES[getDay(date)];
                    return (
                      <TableRow key={h.id}>
                        <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-medium">
                          {format(date, "dd MMM yyyy")}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getDay(date) === 0 ? "destructive" : "outline"}>
                            {dayName}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{h.name}</TableCell>
                        <TableCell className="text-muted-foreground">{h.description || "-"}</TableCell>
                        <TableCell>
                          <Switch
                            checked={h.is_active}
                            disabled={!isSuperAdmin}
                            onCheckedChange={(checked) =>
                              toggleActiveMutation.mutate({ id: h.id, is_active: checked })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {isSuperAdmin ? (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => openEdit(h)} title="Edit">
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive"
                                  onClick={() => deleteMutation.mutate(h.id)}
                                  title="Delete"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">View only</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div className="mt-3 text-sm text-muted-foreground">
            Total: {filtered.length} holidays | Active: {filtered.filter((h: any) => h.is_active).length}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Holiday" : "Add Public Holiday"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Date *</Label>
              <Input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
            </div>
            <div>
              <Label>Holiday Name *</Label>
              <Input
                placeholder="e.g. Republic Day, Diwali..."
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                placeholder="Optional description..."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
              {editingId ? "Update" : "Add Holiday"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
