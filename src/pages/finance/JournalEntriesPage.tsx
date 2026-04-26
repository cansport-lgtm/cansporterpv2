import { useState, useRef } from "react";
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
import { Plus, Trash2, CheckCircle, AlertTriangle, Download, Upload } from "lucide-react";
import * as XLSX from "xlsx";

interface JELine {
  account_id: string;
  debit_amount: number;
  credit_amount: number;
  description: string;
}

export default function JournalEntriesPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [description, setDescription] = useState("");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split("T")[0]);
  const [lines, setLines] = useState<JELine[]>([
    { account_id: "", debit_amount: 0, credit_amount: 0, description: "" },
    { account_id: "", debit_amount: 0, credit_amount: 0, description: "" },
  ]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: periods } = useQuery({
    queryKey: ["finance-periods-open"],
    queryFn: async () => {
      const { data, error } = await supabase.from("finance_periods").select("*").order("year", { ascending: false }).order("month", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: accounts } = useQuery({
    queryKey: ["finance-coa-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("finance_chart_of_accounts").select("*").eq("is_active", true).order("code");
      if (error) throw error;
      return data;
    },
  });

  const { data: journalEntries, isLoading } = useQuery({
    queryKey: ["finance-journal-entries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_journal_entries")
        .select("*, period:finance_periods(period_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const totalDebit = lines.reduce((s, l) => s + (l.debit_amount || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit_amount || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const addLine = () => setLines([...lines, { account_id: "", debit_amount: 0, credit_amount: 0, description: "" }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: keyof JELine, value: any) => {
    const updated = [...lines];
    updated[i] = { ...updated[i], [field]: value };
    setLines(updated);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPeriodId) throw new Error("Select a period");
      if (!isBalanced) throw new Error("Journal entry must be balanced");

      const { data: je, error: jeError } = await supabase.from("finance_journal_entries").insert({
        period_id: selectedPeriodId,
        description,
        entry_date: entryDate,
        entry_number: "",
        total_debit: totalDebit,
        total_credit: totalCredit,
        status: "posted",
      }).select().single();
      if (jeError) throw jeError;

      const jeLines = lines.filter((l) => l.account_id).map((l) => ({
        journal_entry_id: je.id,
        account_id: l.account_id,
        debit_amount: l.debit_amount,
        credit_amount: l.credit_amount,
        description: l.description,
      }));
      const { error: lineError } = await supabase.from("finance_journal_entry_lines").insert(jeLines);
      if (lineError) throw lineError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-journal-entries"] });
      toast({ title: "Journal entry posted" });
      setDialogOpen(false);
      setLines([
        { account_id: "", debit_amount: 0, credit_amount: 0, description: "" },
        { account_id: "", debit_amount: 0, credit_amount: 0, description: "" },
      ]);
      setDescription("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleExport = () => {
    if (!journalEntries?.length) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }
    const exportData = journalEntries.map((je: any) => ({
      "Entry #": je.entry_number || "",
      "Date": je.entry_date,
      "Period": je.period?.period_name || "",
      "Description": je.description || "",
      "Total Debit": Number(je.total_debit || 0),
      "Total Credit": Number(je.total_credit || 0),
      "Status": je.status || "",
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Journal Entries");
    XLSX.writeFile(wb, `Journal_Entries_${new Date().toISOString().split("T")[0]}.xlsx`);
    toast({ title: "Exported successfully" });
  };

  const importMutation = useMutation({
    mutationFn: async (rows: any[]) => {
      if (!rows.length) throw new Error("No valid rows found");

      for (const row of rows) {
        const periodName = String(row["Period"] || "").trim();
        const matchedPeriod = periods?.find((p) => p.period_name === periodName);
        if (!matchedPeriod) throw new Error(`Period "${periodName}" not found`);
        if (matchedPeriod.is_closed) throw new Error(`Period "${periodName}" is closed`);

        const debit = Number(row["Total Debit"] || 0);
        const credit = Number(row["Total Credit"] || 0);
        if (Math.abs(debit - credit) > 0.01 || debit <= 0) {
          throw new Error(`Row with date "${row["Date"]}" is not balanced`);
        }

        const { error } = await supabase.from("finance_journal_entries").insert({
          period_id: matchedPeriod.id,
          description: row["Description"] || "",
          entry_date: row["Date"] || new Date().toISOString().split("T")[0],
          entry_number: row["Entry #"] || "",
          total_debit: debit,
          total_credit: credit,
          status: row["Status"] || "posted",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-journal-entries"] });
      toast({ title: "Imported successfully" });
    },
    onError: (err: any) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws);
        importMutation.mutate(rows);
      } catch {
        toast({ title: "Failed to parse file", variant: "destructive" });
      }
    };
    reader.readAsBinaryString(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <ERPLayout>
      <PageHeader title="Journal Entries" description="Adjustment journal entries">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" />Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" />Import
          </Button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" />New Entry</Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>New Journal Entry</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>Period</Label>
                    <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{periods?.filter((p) => !p.is_closed).map((p) => <SelectItem key={p.id} value={p.id}>{p.period_name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Date</Label><Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
                  <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Adjustment for..." /></div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="w-32">Debit</TableHead>
                      <TableHead className="w-32">Credit</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Select value={line.account_id} onValueChange={(v) => updateLine(i, "account_id", v)}>
                            <SelectTrigger className="h-8"><SelectValue placeholder="Select account" /></SelectTrigger>
                            <SelectContent>{accounts?.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} - {a.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell><Input type="number" className="h-8 text-right" value={line.debit_amount || ""} onChange={(e) => updateLine(i, "debit_amount", parseFloat(e.target.value) || 0)} /></TableCell>
                        <TableCell><Input type="number" className="h-8 text-right" value={line.credit_amount || ""} onChange={(e) => updateLine(i, "credit_amount", parseFloat(e.target.value) || 0)} /></TableCell>
                        <TableCell><Input className="h-8 text-xs" value={line.description} onChange={(e) => updateLine(i, "description", e.target.value)} /></TableCell>
                        <TableCell>{lines.length > 2 && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeLine(i)}><Trash2 className="h-3 w-3" /></Button>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="flex justify-between items-center">
                  <Button variant="outline" size="sm" onClick={addLine}><Plus className="h-3 w-3 mr-1" />Add Line</Button>
                  <div className="flex items-center gap-4 text-sm">
                    <span>Debit: <strong>Rs. {totalDebit.toLocaleString()}</strong></span>
                    <span>Credit: <strong>Rs. {totalCredit.toLocaleString()}</strong></span>
                    {isBalanced ? <CheckCircle className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
                  </div>
                </div>

                <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={!isBalanced || saveMutation.isPending}>
                  Post Journal Entry
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </PageHeader>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entry #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : !journalEntries?.length ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No journal entries</TableCell></TableRow>
            ) : (
              journalEntries.map((je: any) => (
                <TableRow key={je.id}>
                  <TableCell className="font-mono text-sm">{je.entry_number}</TableCell>
                  <TableCell>{je.entry_date}</TableCell>
                  <TableCell>{je.period?.period_name}</TableCell>
                  <TableCell>{je.description || "-"}</TableCell>
                  <TableCell className="text-right">Rs. {Number(je.total_debit || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right">Rs. {Number(je.total_credit || 0).toLocaleString()}</TableCell>
                  <TableCell><Badge variant={je.status === "posted" ? "default" : "outline"}>{je.status}</Badge></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </ERPLayout>
  );
}
