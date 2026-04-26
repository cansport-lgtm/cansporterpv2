import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Clock, Save, Plus, ChevronsUpDown, Check, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

const HOUR_SLOTS = Array.from({ length: 16 }, (_, i) => {
  const h = i + 6;
  const start = h % 12 === 0 ? 12 : h % 12;
  const end = (h + 1) % 12 === 0 ? 12 : (h + 1) % 12;
  const startAmPm = h < 12 ? "AM" : "PM";
  const endAmPm = (h + 1) < 12 || (h + 1) === 24 ? "AM" : "PM";
  return { value: h, label: `${start}:00 ${startAmPm} – ${end}:00 ${endAmPm}` };
});

interface EntryRow {
  process_name: string;
  worker_name: string;
  quantity: string;
  remarks: string;
}

export default function HourlyProductionEntryPage() {
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole('super_admin');
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [selectedHour, setSelectedHour] = useState<number>(new Date().getHours());
  const [trackWorkers, setTrackWorkers] = useState(false);
  const [rows, setRows] = useState<EntryRow[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");

  const { data: departments = [] } = useQuery({
    queryKey: ["production-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: processes = [] } = useQuery({
    queryKey: ["qa-processes-hourly", selectedDepartment],
    queryFn: async () => {
      let query = (supabase as any)
        .from("qa_processes")
        .select("id, name, code, department_id")
        .eq("is_active", true)
        .eq("is_hourly_tracked", true);
      if (selectedDepartment !== "all") {
        query = query.eq("department_id", selectedDepartment);
      }
      const { data, error } = await query.order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: labourWorkers = [] } = useQuery({
    queryKey: ["active-labour-employees"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("labour_employees")
        .select("id, full_name, employee_code")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: existingEntries = [] } = useQuery({
    queryKey: ["hourly-entries", selectedDate, selectedHour],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hourly_production_entries")
        .select("*")
        .eq("entry_date", selectedDate)
        .eq("hour_slot", selectedHour);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Fetch all entries for the day to auto-load worker assignments for new hours
  const { data: allDayEntries = [] } = useQuery({
    queryKey: ["hourly-entries-day", selectedDate],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hourly_production_entries")
        .select("process_name, worker_name")
        .eq("entry_date", selectedDate)
        .not("worker_name", "is", null);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  useEffect(() => {
    if (processes.length === 0) return;
    if (trackWorkers) {
      const workerRows: EntryRow[] = existingEntries.map((e: any) => ({
        process_name: e.process_name,
        worker_name: e.worker_name || "",
        quantity: String(e.quantity || 0),
        remarks: e.remarks || "",
      }));

      // Worker name must always be selected manually by the user

      processes.forEach((p: any) => {
        if (!workerRows.some((r) => r.process_name === p.name)) {
          workerRows.push({ process_name: p.name, worker_name: "", quantity: "", remarks: "" });
        }
      });
      setRows(workerRows);
    } else {
      const processRows: EntryRow[] = processes.map((p: any) => {
        const existing = existingEntries.find((e: any) => e.process_name === p.name && !e.worker_name);
        return {
          process_name: p.name,
          worker_name: "",
          quantity: existing ? String(existing.quantity) : "",
          remarks: existing?.remarks || "",
        };
      });
      setRows(processRows);
    }
  }, [processes, existingEntries, allDayEntries, trackWorkers]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const validRows = rows.filter((r) => r.quantity && Number(r.quantity) > 0);
      if (validRows.length === 0) throw new Error("No entries to save");

      await (supabase as any)
        .from("hourly_production_entries")
        .delete()
        .eq("entry_date", selectedDate)
        .eq("hour_slot", selectedHour);

      const inserts = validRows.map((r) => ({
        entry_date: selectedDate,
        hour_slot: selectedHour,
        process_name: r.process_name,
        worker_name: r.worker_name || null,
        quantity: Number(r.quantity),
        remarks: r.remarks || null,
        created_by: user?.id || null,
      }));

      const { error } = await (supabase as any).from("hourly_production_entries").insert(inserts);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Hourly production saved successfully");
      queryClient.invalidateQueries({ queryKey: ["hourly-entries"] });
      queryClient.invalidateQueries({ queryKey: ["hourly-production-entries-today"] });
      queryClient.invalidateQueries({ queryKey: ["hourly-all-day-entries"] });
      setRows([{ process_name: "", worker_name: "", quantity: "", remarks: "" }]);
    },
    onError: (err: any) => toast.error(err.message),
  });


  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any)
        .from("hourly_production_entries")
        .delete()
        .eq("entry_date", selectedDate)
        .eq("hour_slot", selectedHour);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entries deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["hourly-entries"] });
      queryClient.invalidateQueries({ queryKey: ["hourly-entries-day"] });
      queryClient.invalidateQueries({ queryKey: ["hourly-production-entries-today"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateRow = (index: number, field: keyof EntryRow, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const addWorkerRow = () => {
    setRows((prev) => [...prev, { process_name: processes[0]?.name || "", worker_name: "", quantity: "", remarks: "" }]);
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Hourly Production Entry" description="Enter hourly production data for each process" icon={Clock} iconColor="bg-violet-600 text-white" />

        <Card>
          <CardHeader><CardTitle>Select Date & Hour</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
              <div>
                <Label>Date</Label>
                <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
              </div>
              <div>
                <Label>Hour Slot</Label>
                <Select value={String(selectedHour)} onValueChange={(v) => setSelectedHour(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOUR_SLOTS.map((s) => (
                      <SelectItem key={s.value} value={String(s.value)}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Department</Label>
                <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                  <SelectTrigger><SelectValue placeholder="All Departments" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch checked={trackWorkers} onCheckedChange={setTrackWorkers} />
                <Label>Individual Worker Tracking</Label>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Production Entries</CardTitle>
            <div className="flex gap-2">
              {trackWorkers && (
                <Button variant="outline" size="sm" onClick={addWorkerRow}><Plus className="h-4 w-4 mr-1" /> Add Row</Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Process</TableHead>
                    {trackWorkers && <TableHead>Worker Name</TableHead>}
                    <TableHead className="w-32">Quantity</TableHead>
                    <TableHead>Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell>
                        {trackWorkers ? (
                          <Select value={row.process_name} onValueChange={(v) => updateRow(idx, "process_name", v)}>
                            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {processes.map((p: any) => (
                                <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="font-medium">{row.process_name}</span>
                        )}
                      </TableCell>
                      {trackWorkers && (
                        <TableCell>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" role="combobox" className="w-48 justify-between font-normal">
                                {row.worker_name
                                  ? labourWorkers.find((w: any) => w.full_name === row.worker_name)
                                    ? `${labourWorkers.find((w: any) => w.full_name === row.worker_name).employee_code} - ${row.worker_name}`
                                    : row.worker_name
                                  : "Select worker"}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 p-0" align="start">
                              <Command>
                                <CommandInput placeholder="Search worker..." />
                                <CommandList>
                                  <CommandEmpty>No worker found.</CommandEmpty>
                                  <CommandGroup>
                                    {labourWorkers.map((w: any) => (
                                      <CommandItem
                                        key={w.id}
                                        value={`${w.employee_code} ${w.full_name}`}
                                        onSelect={() => updateRow(idx, "worker_name", w.full_name)}
                                      >
                                        <Check className={cn("mr-2 h-4 w-4", row.worker_name === w.full_name ? "opacity-100" : "opacity-0")} />
                                        {w.employee_code} - {w.full_name}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </TableCell>
                      )}
                      <TableCell><Input type="number" value={row.quantity} onChange={(e) => updateRow(idx, "quantity", e.target.value)} placeholder="0" className="w-28" /></TableCell>
                      <TableCell><Input value={row.remarks} onChange={(e) => updateRow(idx, "remarks", e.target.value)} placeholder="Optional" className="w-40" /></TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={trackWorkers ? 4 : 3} className="text-center text-muted-foreground">No processes configured. Add a process first.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              {isSuperAdmin && existingEntries.length > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={deleteMutation.isPending}>
                      <Trash2 className="h-4 w-4 mr-2" /> Delete Entries
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Hourly Entries?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete all {existingEntries.length} entries for {selectedDate} hour slot {selectedHour}:00. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteMutation.mutate()}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}><Save className="h-4 w-4 mr-2" /> Save All Entries</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
